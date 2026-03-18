import { MatrixClient } from "matrix-bot-sdk";
import { GrafanaConnector, GrafanaLogEntry, normalizeLokiSelector } from "../connectors/grafana";
import { GrafanaAlertsChannelService } from "./grafanaAlertsChannel";
import { BotState, BotStateStore, MonitorDefinition } from "./botStateStore";
import { env } from "../config/env";
import { UserConfigStore } from "./userConfigStore";

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_LOOKBACK_MS = 5 * 60_000;
const DEFAULT_LIMIT = 50;
const DEFAULT_DEDUPE_LIMIT = 2000;
const DEFAULT_SELECTOR = normalizeLokiSelector(env.GRAFANA_LOG_LABEL_SELECTOR);

export class GrafanaMonitorAlertsService {
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly client: MatrixClient,
    private readonly grafana: GrafanaConnector,
    private readonly alertsChannel: GrafanaAlertsChannelService,
    private readonly stateStore: BotStateStore,
    private readonly userConfigStore: UserConfigStore
  ) {}

  async start(): Promise<void> {
    if (!env.hasGrafanaCredentials) {
      return;
    }
    try {
      await this.checkAndSend();
    } catch (error) {
      console.error("Monitor alert check failed during startup:", error);
    }

    this.intervalHandle = setInterval(() => {
      this.checkAndSend().catch((error) => {
        console.error("Monitor alert check failed:", error);
      });
    }, env.grafanaMonitorPollMs ?? DEFAULT_POLL_MS);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async checkAndSend(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      const state = await this.stateStore.load();
      const userConfig = await this.userConfigStore.load();
      if (userConfig.monitors.length === 0) {
        return;
      }

      const roomId = await this.alertsChannel.getOrCreateRoomId(state);
      if (!roomId) {
        return;
      }

      for (const monitor of userConfig.monitors) {
        try {
          await this.checkMonitor(state, roomId, monitor);
        } catch (error) {
          console.error(`Monitor alert check failed for "${monitor.name}" (${monitor.id}):`, error);
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async checkMonitor(state: BotState, roomId: string, monitor: MonitorDefinition): Promise<void> {
    const selector = monitor.selector === "{}" ? DEFAULT_SELECTOR : monitor.selector;
    const safePattern = monitor.pattern.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const query = `${selector} |~ "${safePattern}"`;
    const logs = await this.grafana.queryLogs(
      query,
      env.grafanaMonitorLookbackMs ?? DEFAULT_LOOKBACK_MS,
      env.grafanaMonitorLimit ?? DEFAULT_LIMIT
    );
    if (logs.length === 0) {
      return;
    }

    const seen = new Set(state.monitorSeenKeys[monitor.id] ?? []);
    const fresh = logs.filter((entry) => !seen.has(this.entryKey(entry.timestamp, entry.message)));
    if (fresh.length === 0) {
      return;
    }

    for (const entry of fresh.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
      const body = this.formatAlert(monitor, entry);
      await this.client.sendMessage(roomId, {
        msgtype: "m.text",
        body
      });
      seen.add(this.entryKey(entry.timestamp, entry.message));
    }

    const merged = [...seen];
    state.monitorSeenKeys[monitor.id] =
      merged.length > DEFAULT_DEDUPE_LIMIT ? merged.slice(-DEFAULT_DEDUPE_LIMIT) : merged;
    await this.stateStore.save(state);
  }

  private entryKey(timestamp: string, message: string): string {
    return `${timestamp}|${message}`;
  }

  private formatAlert(monitor: MonitorDefinition, entry: GrafanaLogEntry): string {
    return `[${monitor.name}] ${entry.message}`;
  }
}

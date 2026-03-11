import { MatrixClient } from "matrix-bot-sdk";
import { env } from "../config/env";
import { GrafanaConnector, normalizeLokiSelector } from "../connectors/grafana";
import { GrafanaAlertsChannelService } from "./grafanaAlertsChannel";
import { BotState, BotStateStore } from "./botStateStore";

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_LOOKBACK_MS = 5 * 60_000;
const DEFAULT_LIMIT = 50;
const DEFAULT_DEDUPE_LIMIT = 2000;

export class GrafanaSecurityLoginAlertsService {
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly client: MatrixClient,
    private readonly grafana: GrafanaConnector,
    private readonly alertsChannel: GrafanaAlertsChannelService,
    private readonly stateStore: BotStateStore
  ) {}

  async start(): Promise<void> {
    if (!env.hasGrafanaCredentials || !env.grafanaSecurityLoginEnabled) {
      return;
    }

    const state = await this.stateStore.load();
    const roomId = await this.alertsChannel.getOrCreateRoomId(state);
    if (!roomId) {
      return;
    }

    try {
      await this.checkAndSend(state, roomId);
    } catch (error) {
      console.error("Security login check failed during startup:", error);
    }
    this.intervalHandle = setInterval(() => {
      this.checkAndSend(state, roomId).catch((error) => {
        console.error("Security login check failed:", error);
      });
    }, env.grafanaSecurityLoginPollMs ?? DEFAULT_POLL_MS);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async checkAndSend(state: BotState, roomId: string): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      const query = this.buildQuery();
      if (!query) {
        return;
      }

      const lookbackMs = env.grafanaSecurityLoginLookbackMs ?? DEFAULT_LOOKBACK_MS;
      const limit = env.grafanaSecurityLoginLimit ?? DEFAULT_LIMIT;
      const logs = await this.grafana.queryLogs(query, lookbackMs, limit);

      const seen = new Set(state.securityLoginSeenKeys ?? []);
      const fresh = logs.filter((entry) => !seen.has(this.entryKey(entry.timestamp, entry.message)));
      if (fresh.length === 0) {
        return;
      }

      for (const entry of fresh.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
        const body = this.formatAlert(entry.timestamp, entry.message);
        await this.client.sendMessage(roomId, {
          msgtype: "m.text",
          body
        });
        seen.add(this.entryKey(entry.timestamp, entry.message));
      }

      state.securityLoginSeenKeys = [...seen];
      if (state.securityLoginSeenKeys.length > DEFAULT_DEDUPE_LIMIT) {
        state.securityLoginSeenKeys = state.securityLoginSeenKeys.slice(-DEFAULT_DEDUPE_LIMIT);
      }
      await this.stateStore.save(state);
    } finally {
      this.isRunning = false;
    }
  }

  private buildQuery(): string | null {
    if (env.GRAFANA_SECURITY_LOGIN_QUERY) {
      return env.GRAFANA_SECURITY_LOGIN_QUERY;
    }

    const selector = normalizeLokiSelector(env.GRAFANA_SECURITY_LOGIN_LABEL_SELECTOR);
    return `${selector} |~ "(?i)sshd" |~ "(?i)(accepted password|failed password|session opened for user)"`;
  }

  private entryKey(timestamp: string, message: string): string {
    return `${timestamp}|${message}`;
  }

  private formatAlert(timestamp: string, message: string): string {
    const details = this.extractDetails(message);
    const lines = ["Security alert: SSH password login detected.", `Time: ${timestamp}`];
    if (details) {
      lines.push(`User: ${details.user}`, `Source: ${details.source}`, `Port: ${details.port}`);
    }
    lines.push(`Log: ${message}`);
    return lines.join("\n");
  }

  private extractDetails(message: string): { user: string; source: string; port: string } | null {
    const match = message.match(/Accepted password for (\S+) from (\S+) port (\d+)/i);
    if (!match) {
      return null;
    }

    return {
      user: match[1],
      source: match[2],
      port: match[3]
    };
  }
}

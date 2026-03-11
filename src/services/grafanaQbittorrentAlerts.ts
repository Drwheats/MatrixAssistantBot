import { MatrixClient } from "matrix-bot-sdk";
import { env } from "../config/env";
import { GrafanaConnector, GrafanaLogEntry } from "../connectors/grafana";
import { GrafanaAlertsChannelService } from "./grafanaAlertsChannel";
import { BotState, BotStateStore } from "./botStateStore";

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_LOOKBACK_MS = 5 * 60_000;
const DEFAULT_LIMIT = 50;
const DEFAULT_DEDUPE_LIMIT = 2000;

type QbittorrentEventType = "started" | "finished";

export class GrafanaQbittorrentAlertsService {
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly client: MatrixClient,
    private readonly grafana: GrafanaConnector,
    private readonly alertsChannel: GrafanaAlertsChannelService,
    private readonly stateStore: BotStateStore
  ) {}

  async start(): Promise<void> {
    if (!env.hasGrafanaCredentials || !env.grafanaQbittorrentAlertsEnabled) {
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
      console.error("Qbittorrent alert check failed during startup:", error);
    }

    this.intervalHandle = setInterval(() => {
      this.checkAndSend(state, roomId).catch((error) => {
        console.error("Qbittorrent alert check failed:", error);
      });
    }, env.grafanaQbittorrentPollMs ?? DEFAULT_POLL_MS);
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
      const lookbackMs = env.grafanaQbittorrentLookbackMs ?? DEFAULT_LOOKBACK_MS;
      const limit = env.grafanaQbittorrentLimit ?? DEFAULT_LIMIT;
      const logs = await this.grafana.queryLogs(query, lookbackMs, limit);

      const seen = new Set(state.qbittorrentSeenKeys ?? []);
      const fresh = logs.filter((entry) => !seen.has(this.entryKey(entry.timestamp, entry.message)));
      if (fresh.length === 0) {
        return;
      }

      for (const entry of fresh.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
        const body = this.formatAlert(entry);
        await this.client.sendMessage(roomId, {
          msgtype: "m.text",
          body
        });
        seen.add(this.entryKey(entry.timestamp, entry.message));
      }

      state.qbittorrentSeenKeys = [...seen];
      if (state.qbittorrentSeenKeys.length > DEFAULT_DEDUPE_LIMIT) {
        state.qbittorrentSeenKeys = state.qbittorrentSeenKeys.slice(-DEFAULT_DEDUPE_LIMIT);
      }
      await this.stateStore.save(state);
    } finally {
      this.isRunning = false;
    }
  }

  private buildQuery(): string {
    const selector =
      env.grafanaQbittorrentLabelSelector ??
      env.GRAFANA_LOG_LABEL_SELECTOR ??
      "{}";
    return `${selector} |~ "(?i)added new torrent|torrent download finished"`;
  }

  private entryKey(timestamp: string, message: string): string {
    return `${timestamp}|${message}`;
  }

  private formatAlert(entry: GrafanaLogEntry): string {
    const parsed = this.extractEvent(entry.message);
    const name = parsed?.name ?? "Unknown torrent";
    const type = parsed?.type ?? "started";
    const verb = type === "finished" ? "finished" : "started";
    return `Download ${verb} : ${name}`;
  }

  private extractEvent(message: string): { type: QbittorrentEventType; name?: string } | null {
    const added = message.match(/Added new torrent\. Torrent:\s*"([^"]+)"/i);
    if (added) {
      return { type: "started", name: added[1] };
    }

    const finished = message.match(/Torrent download finished\. Torrent:\s*"([^"]+)"/i);
    if (finished) {
      return { type: "finished", name: finished[1] };
    }

    if (/Torrent download finished/i.test(message)) {
      return { type: "finished" };
    }

    if (/Added new torrent/i.test(message)) {
      return { type: "started" };
    }

    return null;
  }
}

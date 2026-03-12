import { MatrixClient } from "matrix-bot-sdk";
import { env } from "../config/env";
import { GrafanaConnector, GrafanaLogEntry, normalizeLokiSelector } from "../connectors/grafana";
import { GrafanaAlertsChannelService } from "./grafanaAlertsChannel";
import { BotState, BotStateStore } from "./botStateStore";

const DEFAULT_POLL_MS = 15_000;
const DEFAULT_LOOKBACK_MS = 5 * 60_000;
const DEFAULT_LIMIT = 50;
const DEFAULT_DEDUPE_LIMIT = 2000;
const DEFAULT_MAX_ALERTS_PER_POLL = 5;
const DEFAULT_MIN_SECONDS_BETWEEN_ALERTS = 60;

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
      const query = this.buildQuery(state);
      const lookbackMs = env.grafanaQbittorrentLookbackMs ?? DEFAULT_LOOKBACK_MS;
      const limit = env.grafanaQbittorrentLimit ?? DEFAULT_LIMIT;
      const logs = await this.grafana.queryLogs(query, lookbackMs, limit);

      const seen = new Set(state.qbittorrentSeenKeys ?? []);
      const fresh = logs.filter((entry) => !seen.has(this.entryKey(entry.timestamp, entry.message)));
      if (fresh.length === 0) {
        return;
      }

      const sorted = fresh.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      let sentCount = 0;
      let suppressedCount = 0;
      let lastSentAtMs: number | null = null;
      let processedCount = 0;
      for (const entry of sorted) {
        processedCount += 1;
        const entryMs = Date.parse(entry.timestamp);
        const withinMinute =
          Number.isFinite(entryMs) &&
          lastSentAtMs !== null &&
          entryMs - lastSentAtMs < DEFAULT_MIN_SECONDS_BETWEEN_ALERTS * 1000;
        if (withinMinute) {
          suppressedCount += 1;
          seen.add(this.entryKey(entry.timestamp, entry.message));
          continue;
        }

        const body = this.formatAlert(entry);
        await this.client.sendMessage(roomId, {
          msgtype: "m.text",
          body
        });
        sentCount += 1;
        lastSentAtMs = Number.isFinite(entryMs) ? entryMs : Date.now();
        seen.add(this.entryKey(entry.timestamp, entry.message));

        if (sentCount >= DEFAULT_MAX_ALERTS_PER_POLL) {
          break;
        }
      }

      if (processedCount < sorted.length) {
        for (const entry of sorted.slice(processedCount)) {
          seen.add(this.entryKey(entry.timestamp, entry.message));
        }
      }

      const hasMany = sorted.length > DEFAULT_MAX_ALERTS_PER_POLL;
      if (hasMany) {
        await this.client.sendMessage(roomId, {
          msgtype: "m.text",
          body: "and many more"
        });
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

  private buildQuery(state: BotState): string {
    const selector = state.qbittorrentLabelSelector
      ? normalizeLokiSelector(state.qbittorrentLabelSelector)
      : env.GRAFANA_LOG_LABEL_SELECTOR
        ? normalizeLokiSelector(env.GRAFANA_LOG_LABEL_SELECTOR)
        : '{container="qbittorrent",job="qbittorrent"}';
    return `${selector} |~ "(?i)added new torrent|torrent download finished|file error alert"`;
  }

  private entryKey(timestamp: string, message: string): string {
    return `${timestamp}|${message}`;
  }

  private formatAlert(entry: GrafanaLogEntry): string {
    const lines: string[] = [`(N) ${entry.timestamp} - ${entry.message}`, "", "LOG INFORMATION:"];
    const labelLines = formatLabelLines(entry.labels);
    if (labelLines.length === 0) {
      lines.push("(no labels)");
    } else {
      lines.push(...labelLines);
    }
    return lines.join("\n");
  }

}

function formatLabelLines(labels: Record<string, string>): string[] {
  const preferredOrder = ["container", "qbittorrent", "filename", "host", "job", "service_name"];
  const entries = Object.entries(labels);
  const remaining = new Map(entries);
  const lines: string[] = [];

  for (const key of preferredOrder) {
    if (remaining.has(key)) {
      lines.push(key, remaining.get(key) ?? "");
      remaining.delete(key);
    }
  }

  const sorted = [...remaining.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [key, value] of sorted) {
    lines.push(key, value);
  }

  return lines;
}

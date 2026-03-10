import { MatrixClient } from "matrix-bot-sdk";
import { env } from "../config/env";
import { OnePasswordEventsConnector, OnePasswordSignInAttempt } from "../connectors/onePasswordEvents";
import { BotState, BotStateStore } from "./botStateStore";
import { GrafanaAlertsChannelService } from "./grafanaAlertsChannel";

const DEFAULT_DEDUPE_LIMIT = 2000;

export class OnePasswordSigninAlertsService {
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly client: MatrixClient,
    private readonly events: OnePasswordEventsConnector,
    private readonly alertsChannel: GrafanaAlertsChannelService,
    private readonly stateStore: BotStateStore
  ) {}

  async start(): Promise<void> {
    if (!env.hasOnePasswordEventsCredentials || !env.onePasswordSigninAlertsEnabled) {
      return;
    }

    const state = await this.stateStore.load();
    const roomId = await this.alertsChannel.getOrCreateRoomId(state);
    if (!roomId) {
      return;
    }

    await this.checkAndSend(state, roomId);
    this.intervalHandle = setInterval(() => {
      this.checkAndSend(state, roomId).catch((error) => {
        console.error("1Password sign-in check failed:", error);
      });
    }, env.onePasswordSigninPollMs);
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
      const initializedAt = state.onePasswordSigninInitializedAt ?? new Date().toISOString();
      const maxPages = Math.max(1, env.onePasswordSigninMaxPages);
      let cursor = state.onePasswordSigninCursor;
      let resetCursor = false;

      if (!cursor) {
        resetCursor = true;
      }

      const seen = new Set(state.onePasswordSigninSeenIds ?? []);
      let page = 0;
      let hasMore = true;
      const fresh: OnePasswordSignInAttempt[] = [];

      while (hasMore && page < maxPages) {
        const response = await this.events.getSignInAttempts({
          cursor,
          limit: env.onePasswordSigninLimit,
          resetCursor
        });
        resetCursor = false;
        cursor = response.cursor ?? cursor;
        const items = response.items ?? [];
        for (const item of items) {
          if (item.category !== "success" && item.type !== "firewall_reported_success") {
            continue;
          }

          if (item.occurred_at < initializedAt) {
            continue;
          }

          if (seen.has(item.id)) {
            continue;
          }

          fresh.push(item);
        }

        hasMore = Boolean(response.has_more);
        page += 1;
      }

      if (cursor) {
        state.onePasswordSigninCursor = cursor;
      }
      if (!state.onePasswordSigninInitializedAt) {
        state.onePasswordSigninInitializedAt = initializedAt;
      }

      if (fresh.length === 0) {
        await this.stateStore.save(state);
        return;
      }

      for (const item of fresh.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
        const body = formatSignInAlert(item);
        await this.client.sendMessage(roomId, { msgtype: "m.text", body });
        seen.add(item.id);
      }

      state.onePasswordSigninSeenIds = [...seen];
      if (state.onePasswordSigninSeenIds.length > DEFAULT_DEDUPE_LIMIT) {
        state.onePasswordSigninSeenIds = state.onePasswordSigninSeenIds.slice(-DEFAULT_DEDUPE_LIMIT);
      }

      await this.stateStore.save(state);
    } finally {
      this.isRunning = false;
    }
  }
}

function formatSignInAlert(item: OnePasswordSignInAttempt): string {
  const user = item.user?.email ?? item.user?.name ?? "unknown";
  const lines = [
    "Security alert: 1Password sign-in detected.",
    `Time: ${item.occurred_at}`,
    `User: ${user}`,
    `IP: ${item.ip}`,
    item.country ? `Country: ${item.country}` : "",
    item.client?.name ? `Client: ${item.client.name}${item.client.version ? ` ${item.client.version}` : ""}` : "",
    item.client?.platform ? `Platform: ${item.client.platform}` : ""
  ].filter((line) => line.length > 0);

  return lines.join("\n");
}

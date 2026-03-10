import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface BotState {
  announcementRoomId?: string;
  grafanaAlertsRoomId?: string;
  lastWeeklyAnnouncementISO?: string;
  sentReminderKeys: string[];
  securityLoginSeenKeys: string[];
  onePasswordSigninCursor?: string;
  onePasswordSigninInitializedAt?: string;
  onePasswordSigninSeenIds: string[];
}

const DEFAULT_STATE: BotState = {
  sentReminderKeys: [],
  securityLoginSeenKeys: [],
  onePasswordSigninSeenIds: []
};

export class BotStateStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<BotState> {
    if (!existsSync(this.filePath)) {
      return { ...DEFAULT_STATE };
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<BotState>;
      return {
        announcementRoomId: parsed.announcementRoomId,
        grafanaAlertsRoomId: parsed.grafanaAlertsRoomId,
        lastWeeklyAnnouncementISO: parsed.lastWeeklyAnnouncementISO,
        sentReminderKeys: Array.isArray(parsed.sentReminderKeys) ? parsed.sentReminderKeys : [],
        securityLoginSeenKeys: Array.isArray(parsed.securityLoginSeenKeys) ? parsed.securityLoginSeenKeys : [],
        onePasswordSigninCursor: typeof parsed.onePasswordSigninCursor === "string" ? parsed.onePasswordSigninCursor : undefined,
        onePasswordSigninInitializedAt:
          typeof parsed.onePasswordSigninInitializedAt === "string" ? parsed.onePasswordSigninInitializedAt : undefined,
        onePasswordSigninSeenIds: Array.isArray(parsed.onePasswordSigninSeenIds) ? parsed.onePasswordSigninSeenIds : []
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  async save(state: BotState): Promise<void> {
    const current = await this.load();
    const merged: BotState = {
      announcementRoomId: state.announcementRoomId ?? current.announcementRoomId,
      grafanaAlertsRoomId: state.grafanaAlertsRoomId ?? current.grafanaAlertsRoomId,
      lastWeeklyAnnouncementISO: latestISO(state.lastWeeklyAnnouncementISO, current.lastWeeklyAnnouncementISO),
      sentReminderKeys: mergeUnique(current.sentReminderKeys, state.sentReminderKeys, 5000),
      securityLoginSeenKeys: mergeUnique(current.securityLoginSeenKeys, state.securityLoginSeenKeys, 5000),
      onePasswordSigninCursor: state.onePasswordSigninCursor ?? current.onePasswordSigninCursor,
      onePasswordSigninInitializedAt: latestISO(
        state.onePasswordSigninInitializedAt,
        current.onePasswordSigninInitializedAt
      ),
      onePasswordSigninSeenIds: mergeUnique(current.onePasswordSigninSeenIds, state.onePasswordSigninSeenIds, 5000)
    };

    await writeFile(this.filePath, JSON.stringify(merged, null, 2), "utf8");
  }
}

function mergeUnique(existing: string[], incoming: string[], limit: number): string[] {
  if (existing.length === 0) {
    return incoming.slice(-limit);
  }

  const set = new Set(existing);
  for (const value of incoming) {
    set.add(value);
  }

  const merged = [...set];
  return merged.length > limit ? merged.slice(-limit) : merged;
}

function latestISO(primary?: string, fallback?: string): string | undefined {
  if (primary && fallback) {
    return new Date(primary) >= new Date(fallback) ? primary : fallback;
  }

  return primary ?? fallback;
}

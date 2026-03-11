import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface BotState {
  announcementRoomId?: string;
  grafanaAlertsRoomId?: string;
  lastWeeklyAnnouncementISO?: string;
  sentReminderKeys: string[];
  securityLoginSeenKeys: string[];
  botDisplayName?: string;
  promptCommand?: string;
  openMode?: boolean;
  extraAllowedUsers: string[];
}

const DEFAULT_STATE: BotState = {
  sentReminderKeys: [],
  securityLoginSeenKeys: [],
  extraAllowedUsers: []
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
        botDisplayName: typeof parsed.botDisplayName === "string" ? parsed.botDisplayName : undefined,
        promptCommand: typeof parsed.promptCommand === "string" ? parsed.promptCommand : undefined,
        openMode: typeof parsed.openMode === "boolean" ? parsed.openMode : undefined,
        extraAllowedUsers: Array.isArray(parsed.extraAllowedUsers) ? parsed.extraAllowedUsers : []
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  async save(state: Partial<BotState>): Promise<void> {
    const current = await this.load();
    const sentReminderKeys = Array.isArray(state.sentReminderKeys) ? state.sentReminderKeys : [];
    const securityLoginSeenKeys = Array.isArray(state.securityLoginSeenKeys) ? state.securityLoginSeenKeys : [];
    const extraAllowedUsers = Array.isArray(state.extraAllowedUsers) ? state.extraAllowedUsers : undefined;
    const merged: BotState = {
      announcementRoomId: state.announcementRoomId ?? current.announcementRoomId,
      grafanaAlertsRoomId: state.grafanaAlertsRoomId ?? current.grafanaAlertsRoomId,
      lastWeeklyAnnouncementISO: latestISO(state.lastWeeklyAnnouncementISO, current.lastWeeklyAnnouncementISO),
      sentReminderKeys: mergeUnique(current.sentReminderKeys, sentReminderKeys, 5000),
      securityLoginSeenKeys: mergeUnique(current.securityLoginSeenKeys, securityLoginSeenKeys, 5000),
      botDisplayName: state.botDisplayName ?? current.botDisplayName,
      promptCommand: state.promptCommand ?? current.promptCommand,
      openMode: state.openMode ?? current.openMode,
      extraAllowedUsers: extraAllowedUsers ?? current.extraAllowedUsers ?? []
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

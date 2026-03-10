import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface BotState {
  announcementRoomId?: string;
  grafanaAlertsRoomId?: string;
  lastWeeklyAnnouncementISO?: string;
  sentReminderKeys: string[];
}

const DEFAULT_STATE: BotState = {
  sentReminderKeys: []
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
        sentReminderKeys: Array.isArray(parsed.sentReminderKeys) ? parsed.sentReminderKeys : []
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  async save(state: BotState): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}

import { MatrixClient } from "matrix-bot-sdk";
import { TrelloConnector, TrelloCardSummary } from "../connectors/trello";
import { env } from "../config/env";
import { BotState, BotStateStore } from "./botStateStore";

const ANNOUNCEMENT_ROOM_NAME = "Assistant Bot Announcements";
const WEEKLY_MINUTE = 30;
const WEEKLY_HOUR = 10;
const REMINDER_CHECK_INTERVAL_MS = 60_000;

export class AnnouncementService {
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly client: MatrixClient,
    private readonly trello: TrelloConnector,
    private readonly stateStore: BotStateStore
  ) {}

  async start(): Promise<void> {
    const state = await this.stateStore.load();
    const roomId = await this.ensureAnnouncementRoom(state);
    if (!roomId) {
      return;
    }

    await this.checkAndSend(state, roomId);
    this.intervalHandle = setInterval(() => {
      this.checkAndSend(state, roomId).catch((error) => {
        console.error("Announcement check failed:", error);
      });
    }, REMINDER_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async ensureAnnouncementRoom(state: BotState): Promise<string | null> {
    if (state.announcementRoomId) {
      return state.announcementRoomId;
    }

    const invitees = env.allowedUsers;
    const roomId = await this.client.createRoom({
      name: ANNOUNCEMENT_ROOM_NAME,
      topic: "Automated weekly and due-date reminders",
      preset: "private_chat",
      invite: invitees
    });

    state.announcementRoomId = roomId;
    await this.stateStore.save(state);
    return roomId;
  }

  private async checkAndSend(state: BotState, roomId: string): Promise<void> {
    if (!env.hasTrelloCredentials) {
      return;
    }

    const now = new Date();
    await this.maybeSendWeeklyDigest(state, roomId, now);
    await this.maybeSendDueReminders(state, roomId, now);
  }

  private async maybeSendWeeklyDigest(state: BotState, roomId: string, now: Date): Promise<void> {
    const isScheduledTime =
      now.getDay() === 1 && now.getHours() === WEEKLY_HOUR && now.getMinutes() === WEEKLY_MINUTE;
    if (!isScheduledTime) {
      return;
    }

    const weekStart = startOfWeekMonday(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const alreadySent = state.lastWeeklyAnnouncementISO
      ? new Date(state.lastWeeklyAnnouncementISO) >= weekStart
      : false;
    if (alreadySent) {
      return;
    }

    const tasks = await this.trello.getDueBetween(now, weekEnd, 50);
    if (tasks.length === 0) {
      await this.sendMessage(roomId, "Weekly tasks: no Trello cards due this week.");
    } else {
      const body = [
        "Weekly tasks due this week:",
        ...tasks.map((task) => `- ${formatEST(task.due)} EST: ${task.name}${task.url ? ` - ${task.url}` : ""}`)
      ].join("\n");
      await this.sendMessage(roomId, body);
    }

    state.lastWeeklyAnnouncementISO = now.toISOString();
    await this.stateStore.save(state);
  }

  private async maybeSendDueReminders(state: BotState, roomId: string, now: Date): Promise<void> {
    const endWindow = new Date(now.getTime() + 61 * 60 * 1000);
    const tasks = await this.trello.getDueBetween(now, endWindow, 200);
    let changed = false;

    for (const task of tasks) {
      if (this.isInWindow(task, now, 60) && this.markReminder(state, task, 60)) {
        const body = `Reminder: "${task.name}" is due in 1 hour (${formatEST(task.due)} EST).${
          task.url ? ` ${task.url}` : ""
        }`;
        await this.sendMessage(
          roomId,
          body
        );
        changed = true;
      }

      if (this.isInWindow(task, now, 5) && this.markReminder(state, task, 5)) {
        const body = `Reminder: "${task.name}" is due in 5 minutes (${formatEST(task.due)} EST).${
          task.url ? ` ${task.url}` : ""
        }`;
        await this.sendMessage(
          roomId,
          body
        );
        changed = true;
      }
    }

    if (changed) {
      await this.stateStore.save(state);
    }
  }

  private isInWindow(task: TrelloCardSummary, now: Date, minutesBeforeDue: number): boolean {
    const dueMs = new Date(task.due).getTime();
    const diffMs = dueMs - now.getTime();
    const lower = (minutesBeforeDue - 1) * 60_000;
    const upper = minutesBeforeDue * 60_000;
    return diffMs > lower && diffMs <= upper;
  }

  private markReminder(state: BotState, task: TrelloCardSummary, minutesBeforeDue: number): boolean {
    const key = `${task.id}:${task.due}:${minutesBeforeDue}`;
    if (state.sentReminderKeys.includes(key)) {
      return false;
    }

    state.sentReminderKeys.push(key);
    if (state.sentReminderKeys.length > 5000) {
      state.sentReminderKeys = state.sentReminderKeys.slice(-5000);
    }
    return true;
  }

  private async sendMessage(roomId: string, body: string): Promise<void> {
    const content = {
      msgtype: "m.text",
      body
    };

    await this.client.sendMessage(roomId, content);
  }
}

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function formatEST(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

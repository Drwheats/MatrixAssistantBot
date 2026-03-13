import { MatrixClient } from "matrix-bot-sdk";
import { TrelloConnector, TrelloCardSummary } from "../connectors/trello";
import { env } from "../config/env";
import { BotState, BotStateStore } from "./botStateStore";
import { buildTrelloSummary, renderDueTodayLines } from "./trelloSummary";
import { getWeatherLocation } from "./weatherLocation";

const ANNOUNCEMENT_ROOM_NAME = "Assistant Bot Announcements";
const WEEKLY_MINUTE = 30;
const WEEKLY_HOUR = 10;
const REMINDER_CHECK_INTERVAL_MS = 60_000;
const WEEKDAY_HOUR = 9;
const WEEKDAY_MINUTE = 30;
const TRELLO_ALERT_TARGET_LIMIT = 2000;

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

    const latest = await this.stateStore.load();
    Object.assign(state, latest);

    const now = new Date();
    await this.maybeSendWeeklyDigest(state, roomId, now);
    await this.maybeSendWeekdaySummary(state, roomId, now);
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
        await this.sendTrelloAlert(state, roomId, body, task.id);
        changed = true;
      }

      if (this.isInWindow(task, now, 5) && this.markReminder(state, task, 5)) {
        const body = `Reminder: "${task.name}" is due in 5 minutes (${formatEST(task.due)} EST).${
          task.url ? ` ${task.url}` : ""
        }`;
        await this.sendTrelloAlert(state, roomId, body, task.id);
        changed = true;
      }
    }

    if (changed) {
      await this.stateStore.save(state);
    }
  }

  private async maybeSendWeekdaySummary(state: BotState, roomId: string, now: Date): Promise<void> {
    const location = getWeatherLocation(state);
    const parts = getZonedParts(now, location.timezone);
    if (!parts) {
      return;
    }

    if (!isWeekday(parts.weekday)) {
      return;
    }

    if (parts.hour !== WEEKDAY_HOUR || parts.minute !== WEEKDAY_MINUTE) {
      return;
    }

    const todayKey = `${parts.year}-${parts.month}-${parts.day}`;
    const lastKey = state.lastWeekdaySummaryISO
      ? zonedDateKey(new Date(state.lastWeekdaySummaryISO), location.timezone)
      : null;
    if (lastKey === todayKey) {
      return;
    }

    const summary = await buildTrelloSummary(this.trello, location);
    const lines = [
      "Daily Trello summary:",
      `To do: ${summary.todoCount}`,
      `Pending: ${summary.pendingCount}`,
      ...renderDueTodayLines(summary.dueToday, location.timezone),
      `${location.name} weather today: ${summary.weather}`
    ];

    await this.sendMessage(roomId, lines.join("\n"));
    state.lastWeekdaySummaryISO = now.toISOString();
    await this.stateStore.save(state);
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

  private async sendTrelloAlert(
    state: BotState,
    roomId: string,
    body: string,
    cardId: string
  ): Promise<void> {
    const eventId = await this.client.sendMessage(roomId, {
      msgtype: "m.text",
      body
    });

    await this.client.sendEvent(roomId, "m.reaction", {
      "m.relates_to": {
        rel_type: "m.annotation",
        event_id: eventId,
        key: "✅"
      }
    });
    await this.client.sendEvent(roomId, "m.reaction", {
      "m.relates_to": {
        rel_type: "m.annotation",
        event_id: eventId,
        key: "💤"
      }
    });

    if (!state.trelloAlertTargets) {
      state.trelloAlertTargets = {};
    }
    state.trelloAlertTargets[eventId] = cardId;

    const keys = Object.keys(state.trelloAlertTargets);
    if (keys.length > TRELLO_ALERT_TARGET_LIMIT) {
      const overflow = keys.length - TRELLO_ALERT_TARGET_LIMIT;
      for (const key of keys.slice(0, overflow)) {
        delete state.trelloAlertTargets[key];
      }
    }
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

function getZonedParts(
  date: Date,
  timeZone: string
): { year: string; month: string; day: string; hour: number; minute: number; weekday: string } | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short"
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  if (!map.year || !map.month || !map.day || !map.hour || !map.minute || !map.weekday) {
    return null;
  }

  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: map.weekday
  };
}

function isWeekday(weekday: string): boolean {
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
}

function zonedDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  return `${map.year}-${map.month}-${map.day}`;
}

import { BotStateStore, DeferredMessage } from "./botStateStore";

const EASTERN_TIMEZONE = "America/New_York";
const QUIET_START_HOUR = 1;
const QUIET_END_HOUR = 8;
const FLUSH_HOUR = 8;
const FLUSH_MINUTE = 30;
const FLUSH_CHECK_INTERVAL_MS = 60_000;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export class QuietHoursService {
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly stateStore: BotStateStore,
    private readonly sendNow: (roomId: string, content: Record<string, unknown>) => Promise<string | undefined>
  ) {}

  async start(): Promise<void> {
    await this.flushIfDue();
    this.intervalHandle = setInterval(() => {
      this.flushIfDue().catch((error) => {
        console.error("Quiet-hours flush failed:", error);
      });
    }, FLUSH_CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async sendText(
    roomId: string,
    body: string,
    content: Record<string, unknown>,
    now: Date = new Date()
  ): Promise<string | undefined> {
    if (!isWithinQuietHours(now)) {
      return this.sendNow(roomId, content);
    }

    const state = await this.stateStore.load();
    const next = [...(state.deferredMessages ?? [])];
    next.push({
      roomId,
      body,
      queuedAtISO: now.toISOString()
    });
    await this.stateStore.save({ deferredMessages: next });
    return undefined;
  }

  async flushIfDue(now: Date = new Date()): Promise<void> {
    if (!shouldFlush(now)) {
      return;
    }

    const state = await this.stateStore.load();
    const deferred = state.deferredMessages ?? [];
    if (deferred.length === 0) {
      return;
    }

    const todayKey = zonedDateKey(now);
    const lastFlushKey = state.lastDeferredFlushISO ? zonedDateKey(new Date(state.lastDeferredFlushISO)) : null;
    if (lastFlushKey === todayKey) {
      return;
    }

    const byRoom = groupByRoom(deferred);
    for (const [roomId, messages] of byRoom) {
      const digestBody = renderDigest(messages);
      await this.sendNow(roomId, { msgtype: "m.text", body: digestBody });
    }

    await this.stateStore.save({
      deferredMessages: [],
      lastDeferredFlushISO: now.toISOString()
    });
  }
}

export function isWithinQuietHours(date: Date): boolean {
  const parts = getEasternParts(date);
  if (!parts) {
    return false;
  }

  return parts.hour >= QUIET_START_HOUR && parts.hour < QUIET_END_HOUR;
}

export function shouldFlush(date: Date): boolean {
  if (isWithinQuietHours(date)) {
    return false;
  }

  const parts = getEasternParts(date);
  if (!parts) {
    return false;
  }

  if (parts.hour > FLUSH_HOUR) {
    return true;
  }
  if (parts.hour < FLUSH_HOUR) {
    return false;
  }
  return parts.minute >= FLUSH_MINUTE;
}

function zonedDateKey(date: Date): string | null {
  const parts = getEasternParts(date);
  if (!parts) {
    return null;
  }
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function getEasternParts(date: Date): ZonedParts | null {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const map: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  const year = Number.parseInt(map.year ?? "", 10);
  const month = Number.parseInt(map.month ?? "", 10);
  const day = Number.parseInt(map.day ?? "", 10);
  const hour = Number.parseInt(map.hour ?? "", 10);
  const minute = Number.parseInt(map.minute ?? "", 10);
  if ([year, month, day, hour, minute].some((value) => !Number.isFinite(value))) {
    return null;
  }

  return { year, month, day, hour, minute };
}

function groupByRoom(messages: DeferredMessage[]): Map<string, DeferredMessage[]> {
  const groups = new Map<string, DeferredMessage[]>();
  for (const message of messages) {
    const list = groups.get(message.roomId);
    if (list) {
      list.push(message);
    } else {
      groups.set(message.roomId, [message]);
    }
  }
  return groups;
}

function renderDigest(messages: DeferredMessage[]): string {
  const lines = ["Quiet-hours digest (queued overnight):", ""];
  for (const message of messages) {
    lines.push("---", message.body);
  }
  return lines.join("\n");
}

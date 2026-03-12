import { CommandContext } from "../types/commandContext";

const createdMessageToCardId = new Map<string, string>();
const createdMessageOrder: string[] = [];
const MAX_REPLY_TRACK = 500;

export async function handleTrelloDueCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAllowedUser) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "You are not allowed to use integration commands."
    });
    return;
  }

  try {
    const cards = await ctx.trello.getDueWithin24h(5);

    if (cards.length === 0) {
      await ctx.client.sendMessage(ctx.roomId, {
        msgtype: "m.text",
        body: "No Trello cards due in the next 24h."
      });
      return;
    }

    const body = [
      "Trello cards due in next 24h:",
      ...cards.map((c) => `- ${formatEST(c.due)} EST: ${c.name}${c.url ? ` - ${c.url}` : ""}`)
    ].join("\n");

    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Trello error: ${message}`
    });
  }
}

export async function handleTrelloOverdueCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAllowedUser) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "You are not allowed to use integration commands."
    });
    return;
  }

  try {
    const cards = await ctx.trello.getOverdue(10);
    const body =
      cards.length === 0
        ? "No overdue Trello cards."
        : [
            "Overdue Trello cards:",
            ...cards.map((c) => `- ${formatEST(c.due)} EST: ${c.name}${c.url ? ` - ${c.url}` : ""}`)
          ].join("\n");

    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Trello error: ${message}`
    });
  }
}

export async function handleTrelloCreateCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAllowedUser) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "You are not allowed to use integration commands."
    });
    return;
  }

  const parsed = parseCreateInput(ctx.commandBody);
  if (!parsed) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: 'Usage: !trello create "TASK NAME" DATE'
    });
    return;
  }

  const dueDate = parseNaturalDate(parsed.dateInput);
  if (!dueDate) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body:
        `Could not understand date: "${parsed.dateInput}". ` +
        "Examples: this thursday, march 12th at 12:30pm, tomorrow at 9am, end of week, next friday, the 15th, 15"
    });
    return;
  }

  try {
    const card = await ctx.trello.createCard(parsed.taskName, dueDate);
    const eventId = await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Created Trello card: ${card.name}\nDue: ${formatEST(card.due)} EST${card.url ? `\n${card.url}` : ""}`
    });
    rememberCreatedCardMessage(eventId, card.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Trello error: ${message}`
    });
  }
}

export async function handleTrelloReplyDescriptionMessage(
  ctx: CommandContext,
  event: Record<string, any>
): Promise<boolean> {
  if (!ctx.isAllowedUser) {
    return false;
  }

  const body = String(event?.content?.body ?? "").trim();
  if (!body || body.startsWith("!")) {
    return false;
  }

  const replyToEventId = getReplyToEventId(event);
  if (!replyToEventId) {
    return false;
  }

  const cardId = createdMessageToCardId.get(replyToEventId);
  if (!cardId) {
    return false;
  }

  try {
    await ctx.trello.appendCardDescription(cardId, body);
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Added your reply to the Trello card description."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Trello error: ${message}`
    });
  }

  return true;
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

function parseCreateInput(commandBody: string): { taskName: string; dateInput: string } | null {
  const match = commandBody.match(/^!trello\s+create\s+"([^"]+)"\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const taskName = match[1].trim();
  const dateInput = match[2].trim();
  if (!taskName || !dateInput) {
    return null;
  }

  return { taskName, dateInput };
}

function parseNaturalDate(input: string): Date | null {
  let normalized = input.trim().toLowerCase().replace(/\s+/g, " ");
  normalized = normalized.replace(/^(at|by)\s+/, "");
  const { dateText, time } = extractTime(normalized);
  const text = dateText.replace(/^(at|by)\s+/, "");
  const now = new Date();
  const relative = parseRelativeDuration(text);
  if (relative !== null) {
    return new Date(now.getTime() + relative);
  }

  const inMinutesMatch = text.match(/^in\s+(\d+)\s+minutes?$/);
  if (inMinutesMatch) {
    const minutes = Number(inMinutesMatch[1]);
    if (Number.isInteger(minutes) && minutes >= 0) {
      return new Date(now.getTime() + minutes * 60_000);
    }
  }

  const inHoursMatch = text.match(/^in\s+(\d+)\s+hours?$/);
  if (inHoursMatch) {
    const hours = Number(inHoursMatch[1]);
    if (Number.isInteger(hours) && hours >= 0) {
      return new Date(now.getTime() + hours * 60_000 * 60);
    }
  }

  const rawMinutesMatch = text.match(/^(\d+)\s+minutes?$/);
  if (rawMinutesMatch) {
    const minutes = Number(rawMinutesMatch[1]);
    if (Number.isInteger(minutes) && minutes >= 0) {
      return new Date(now.getTime() + minutes * 60_000);
    }
  }

  const rawHoursMatch = text.match(/^(\d+)\s+hours?$/);
  if (rawHoursMatch) {
    const hours = Number(rawHoursMatch[1]);
    if (Number.isInteger(hours) && hours >= 0) {
      return new Date(now.getTime() + hours * 60_000 * 60);
    }
  }

  if (text === "tomorrow" || text === "tommorow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return withOptionalTime(d, time);
  }

  if (text === "today") {
    return withOptionalTime(now, time);
  }

  if (text === "end of week") {
    const d = new Date(now);
    const day = d.getDay();
    const daysUntilSunday = (7 - day) % 7;
    d.setDate(d.getDate() + daysUntilSunday);
    return withOptionalTime(d, time);
  }

  if (text === "end of month") {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return withOptionalTime(d, time);
  }

  const inDaysMatch = text.match(/^in\s+(\d+)\s+days?$/);
  if (inDaysMatch) {
    const days = Number(inDaysMatch[1]);
    if (Number.isInteger(days) && days >= 0) {
      const d = new Date(now);
      d.setDate(d.getDate() + days);
      return withOptionalTime(d, time);
    }
  }

  const weekdayMatch = text.match(
    /^(this|next)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/
  );
  if (weekdayMatch) {
    const qualifier = weekdayMatch[1];
    const weekday = weekdayIndex(weekdayMatch[2]);
    if (weekday !== null) {
      return withOptionalTime(nextWeekday(now, weekday, qualifier === "this"), time);
    }
  }

  const nextMonthDayMatch = text.match(/^next\s+month\s+(.+)$/);
  if (nextMonthDayMatch) {
    const day = parseDayToken(nextMonthDayMatch[1].trim());
    if (day !== null) {
      const d = dayInMonthOrNull(now.getFullYear(), now.getMonth() + 1, day);
      return d ? withOptionalTime(d, time) : null;
    }
  }

  const theDayMatch = text.match(/^the\s+(.+)$/);
  if (theDayMatch) {
    const day = parseDayToken(theDayMatch[1].trim());
    if (day !== null) {
      const d = nextOccurrenceOfDay(now, day);
      return d ? withOptionalTime(d, time) : null;
    }
  }

  const bareDay = parseDayToken(text);
  if (bareDay !== null) {
    const d = nextOccurrenceOfDay(now, bareDay);
    return d ? withOptionalTime(d, time) : null;
  }

  const monthMatch = text.match(
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+([a-z0-9-]+)(?:\s+(\d{4}))?$/
  );
  if (monthMatch) {
    const monthIndex = monthToIndex(monthMatch[1]);
    const day = parseDayToken(monthMatch[2]);
    const year = monthMatch[3] ? Number(monthMatch[3]) : now.getFullYear();

    if (monthIndex !== null && day !== null && day >= 1 && day <= 31) {
      const result = new Date(year, monthIndex, day);
      if (Number.isNaN(result.getTime())) {
        return null;
      }

      if (!monthMatch[3] && result < now) {
        result.setFullYear(result.getFullYear() + 1);
      }

      return withOptionalTime(result, time);
    }
  }

  const parsed = Date.parse(dateText);
  if (Number.isNaN(parsed)) {
    return null;
  }

  const d = new Date(parsed);
  if (time) {
    return withOptionalTime(d, time);
  }

  if (!containsExplicitTime(text)) {
    return atEndOfDay(d);
  }
  return d;
}

function monthToIndex(token: string): number | null {
  const normalized = token.slice(0, 3);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const idx = months.indexOf(normalized);
  return idx >= 0 ? idx : null;
}

function parseDayToken(token: string): number | null {
  const cleaned = token.trim().toLowerCase();
  const numeric = Number(cleaned.replace(/(st|nd|rd|th)$/i, ""));
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 31) {
    return numeric;
  }

  const ordinals: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    eleventh: 11,
    twelfth: 12,
    thirteenth: 13,
    fourteenth: 14,
    fifteenth: 15,
    sixteenth: 16,
    seventeenth: 17,
    eighteenth: 18,
    nineteenth: 19,
    twentieth: 20,
    twentyfirst: 21,
    "twenty-first": 21,
    twentysecond: 22,
    "twenty-second": 22,
    twentythird: 23,
    "twenty-third": 23,
    twentyfourth: 24,
    "twenty-fourth": 24,
    twentyfifth: 25,
    "twenty-fifth": 25,
    twentysixth: 26,
    "twenty-sixth": 26,
    twentyseventh: 27,
    "twenty-seventh": 27,
    twentyeighth: 28,
    "twenty-eighth": 28,
    twentyninth: 29,
    "twenty-ninth": 29,
    thirtieth: 30,
    thirtyfirst: 31,
    "thirty-first": 31
  };

  return ordinals[cleaned] ?? null;
}

function containsExplicitTime(text: string): boolean {
  return /\d{1,2}:\d{2}|\b(am|pm)\b|\bnoon\b|\bmidnight\b/.test(text);
}

function atEndOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 0, 0);
  return d;
}

function withOptionalTime(date: Date, time: ParsedTime | null): Date {
  if (!time) {
    return atEndOfDay(date);
  }

  const d = new Date(date);
  d.setHours(time.hours, time.minutes, 0, 0);
  return d;
}

function weekdayIndex(name: string): number | null {
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const idx = weekdays.indexOf(name.toLowerCase());
  return idx >= 0 ? idx : null;
}

function nextWeekday(from: Date, targetWeekday: number, allowToday: boolean): Date {
  const d = new Date(from);
  const current = d.getDay();
  let delta = (targetWeekday - current + 7) % 7;
  if (delta === 0 && !allowToday) {
    delta = 7;
  }
  d.setDate(d.getDate() + delta);
  return d;
}

function nextOccurrenceOfDay(from: Date, day: number): Date | null {
  const currentMonth = dayInMonthOrNull(from.getFullYear(), from.getMonth(), day);
  if (currentMonth && currentMonth >= from) {
    return currentMonth;
  }

  return dayInMonthOrNull(from.getFullYear(), from.getMonth() + 1, day);
}

function dayInMonthOrNull(year: number, monthIndex: number, day: number): Date | null {
  const d = new Date(year, monthIndex, day);
  if (d.getDate() !== day) {
    return null;
  }
  return atEndOfDay(d);
}

function getReplyToEventId(event: Record<string, any>): string | null {
  const relatesTo = event?.content?.["m.relates_to"];
  const inReplyTo = relatesTo?.["m.in_reply_to"];
  const eventId = inReplyTo?.event_id;
  return typeof eventId === "string" ? eventId : null;
}

function rememberCreatedCardMessage(eventId: string, cardId: string): void {
  createdMessageToCardId.set(eventId, cardId);
  createdMessageOrder.push(eventId);
  if (createdMessageOrder.length > MAX_REPLY_TRACK) {
    const oldest = createdMessageOrder.shift();
    if (oldest) {
      createdMessageToCardId.delete(oldest);
    }
  }
}

interface ParsedTime {
  hours: number;
  minutes: number;
}

function extractTime(text: string): { dateText: string; time: ParsedTime | null } {
  if (/\bnoon\b/.test(text)) {
    return {
      dateText: text.replace(/\b(?:at|by)\s+noon\b|\bnoon\b/g, "").trim(),
      time: { hours: 12, minutes: 0 }
    };
  }

  if (/\bmidnight\b/.test(text)) {
    return {
      dateText: text.replace(/\b(?:at|by)\s+midnight\b|\bmidnight\b/g, "").trim(),
      time: { hours: 0, minutes: 0 }
    };
  }

  const amPmMatch = text.match(/\b(?:(?:at|by)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (amPmMatch) {
    const rawHour = Number(amPmMatch[1]);
    const minutes = Number(amPmMatch[2] ?? "0");
    if (rawHour >= 1 && rawHour <= 12 && minutes >= 0 && minutes <= 59) {
      let hours = rawHour % 12;
      if (amPmMatch[3] === "pm") {
        hours += 12;
      }
      return {
        dateText: text.replace(amPmMatch[0], "").trim(),
        time: { hours, minutes }
      };
    }
  }

  const twentyFourMatch = text.match(/\b(?:(?:at|by)\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFourMatch) {
    return {
      dateText: text.replace(twentyFourMatch[0], "").trim(),
      time: { hours: Number(twentyFourMatch[1]), minutes: Number(twentyFourMatch[2]) }
    };
  }

  return { dateText: text, time: null };
}

function parseRelativeDuration(text: string): number | null {
  const normalized = text.replace(/\s+from\s+now$/, "");
  const hoursMinutesMatch = normalized.match(
    /^(?:in\s+)?(\d+)\s+hours?(?:\s+(\d+)\s+minutes?)?$/
  );
  if (hoursMinutesMatch) {
    const hours = Number(hoursMinutesMatch[1]);
    const minutes = Number(hoursMinutesMatch[2] ?? "0");
    if (Number.isInteger(hours) && hours >= 0 && Number.isInteger(minutes) && minutes >= 0) {
      return hours * 60 * 60_000 + minutes * 60_000;
    }
  }

  const minutesMatch = normalized.match(/^(?:in\s+)?(\d+)\s+minutes?$/);
  if (minutesMatch) {
    const minutes = Number(minutesMatch[1]);
    if (Number.isInteger(minutes) && minutes >= 0) {
      return minutes * 60_000;
    }
  }

  const hoursMatch = normalized.match(/^(?:in\s+)?(\d+)\s+hours?$/);
  if (hoursMatch) {
    const hours = Number(hoursMatch[1]);
    if (Number.isInteger(hours) && hours >= 0) {
      return hours * 60 * 60_000;
    }
  }

  return null;
}

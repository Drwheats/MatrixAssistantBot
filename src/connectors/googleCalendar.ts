import { google } from "googleapis";
import { env } from "../config/env";

interface CalendarEventSummary {
  summary: string;
  start: string;
}

export class GoogleCalendarConnector {
  async getTodayEvents(limit = 3): Promise<CalendarEventSummary[]> {
    if (!env.hasGoogleCalendarCredentials) {
      throw new Error("Google Calendar is not configured.");
    }

    const auth = new google.auth.JWT({
      email: env.GOOGLE_CALENDAR_CLIENT_EMAIL,
      key: env.GOOGLE_CALENDAR_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"]
    });

    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const response = await calendar.events.list({
      calendarId: env.GOOGLE_CALENDAR_ID,
      singleEvents: true,
      orderBy: "startTime",
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      maxResults: limit
    });

    const events = response.data.items ?? [];

    return events.map((evt) => {
      const startValue = evt.start?.dateTime ?? evt.start?.date ?? "unknown time";
      return {
        summary: evt.summary ?? "(No title)",
        start: startValue
      };
    });
  }
}

import { TrelloCardSummary, TrelloConnector } from "../connectors/trello";
import { WeatherLocation } from "./weatherLocation";

const TRELLO_TODO_LIST = "todo";
const TRELLO_PENDING_LIST = "pending";

export interface TrelloSummary {
  todoCount: number;
  pendingCount: number;
  dueToday: TrelloCardSummary[];
  weather: string;
}

export async function buildTrelloSummary(
  trello: TrelloConnector,
  location: WeatherLocation
): Promise<TrelloSummary> {
  const [counts, dueToday, weather] = await Promise.all([
    trello.getOpenCountsByListName(),
    trello.getDueToday(location.timezone, 200),
    fetchWeather(location)
  ]);

  return {
    todoCount: counts[TRELLO_TODO_LIST] ?? 0,
    pendingCount: counts[TRELLO_PENDING_LIST] ?? 0,
    dueToday,
    weather
  };
}

export function renderDueTodayLines(dueToday: TrelloCardSummary[], timeZone: string): string[] {
  if (dueToday.length === 0) {
    return ["Due today: none."];
  }

  return [
    "Due today:",
    ...dueToday.map((task) => `- ${formatInTimezone(task.due, timeZone)}: ${task.name}${task.url ? ` - ${task.url}` : ""}`)
  ];
}

export async function fetchWeather(location: WeatherLocation): Promise<string> {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", location.latitude.toString());
    url.searchParams.set("longitude", location.longitude.toString());
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum");
    url.searchParams.set("current", "temperature_2m,weather_code");
    url.searchParams.set("timezone", location.timezone);
    url.searchParams.set("forecast_days", "2");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      current?: {
        temperature_2m?: number;
        weather_code?: number;
      };
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
        weather_code?: number[];
      };
    };

    const todayKey = zonedDateKey(new Date(), location.timezone);
    const timeSeries = data.daily?.time ?? [];
    const dayIndex = Math.max(0, timeSeries.findIndex((day) => day === todayKey));

    const max = data.daily?.temperature_2m_max?.[dayIndex];
    const min = data.daily?.temperature_2m_min?.[dayIndex];
    const precip = data.daily?.precipitation_sum?.[dayIndex];
    const dailyCode = data.daily?.weather_code?.[dayIndex];
    const currentTemp = data.current?.temperature_2m;
    const currentCode = data.current?.weather_code;

    const parts = [];
    const description = typeof currentCode === "number" ? describeWeatherCode(currentCode) : null;
    const fallbackDescription = typeof dailyCode === "number" ? describeWeatherCode(dailyCode) : null;
    if (description) {
      parts.push(description);
    } else if (fallbackDescription) {
      parts.push(fallbackDescription);
    }
    if (typeof currentTemp === "number") {
      parts.push(`Now ${Math.round(currentTemp)}°C`);
    }
    if (typeof min === "number" && typeof max === "number") {
      parts.push(`${Math.round(min)}–${Math.round(max)}°C`);
    } else if (typeof max === "number") {
      parts.push(`High ${Math.round(max)}°C`);
    } else if (typeof min === "number") {
      parts.push(`Low ${Math.round(min)}°C`);
    }
    if (typeof precip === "number") {
      parts.push(`${precip.toFixed(1)} mm precip`);
    }

    return parts.length > 0 ? parts.join(", ") : "Unavailable.";
  } catch (error) {
    console.warn("Failed to fetch weather:", error);
    return "Unavailable.";
  }
}

function zonedDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function formatInTimezone(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short"
  }).format(new Date(value));
}

function describeWeatherCode(code: number): string | null {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code === 51 || code === 53 || code === 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code === 61 || code === 63 || code === 65) return "Rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code === 71 || code === 73 || code === 75) return "Snow";
  if (code === 77) return "Snow grains";
  if (code === 80 || code === 81 || code === 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm with hail";
  return null;
}

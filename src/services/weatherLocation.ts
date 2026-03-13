import { BotState } from "./botStateStore";

export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export const DEFAULT_WEATHER_LOCATION: WeatherLocation = {
  name: "Toronto, Ontario",
  latitude: 43.6532,
  longitude: -79.3832,
  timezone: "America/Toronto"
};

export function getWeatherLocation(state?: BotState): WeatherLocation {
  if (
    state &&
    typeof state.weatherLocationName === "string" &&
    typeof state.weatherLocationLat === "number" &&
    typeof state.weatherLocationLon === "number" &&
    typeof state.weatherLocationTimezone === "string"
  ) {
    return {
      name: state.weatherLocationName,
      latitude: state.weatherLocationLat,
      longitude: state.weatherLocationLon,
      timezone: state.weatherLocationTimezone
    };
  }

  return DEFAULT_WEATHER_LOCATION;
}

export async function geocodeLocation(query: string): Promise<WeatherLocation | null> {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", trimmed);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geocoding error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    results?: Array<{
      name?: string;
      admin1?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
      timezone?: string;
    }>;
  };

  const result = data.results?.[0];
  if (
    !result ||
    typeof result.latitude !== "number" ||
    typeof result.longitude !== "number" ||
    typeof result.timezone !== "string"
  ) {
    return null;
  }

  const nameParts = [result.name, result.admin1, result.country].filter((part) => !!part);
  const name = nameParts.length > 0 ? nameParts.join(", ") : trimmed;
  return {
    name,
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone
  };
}

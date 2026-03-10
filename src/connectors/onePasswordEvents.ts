import { env } from "../config/env";

export interface OnePasswordSignInAttempt {
  id: string;
  occurred_at: string;
  category: string;
  type: string;
  ip: string;
  country?: string;
  user?: { name?: string; email?: string; uuid?: string };
  client?: { name?: string; version?: string; platform?: string };
}

interface OnePasswordSignInResponse {
  cursor?: string;
  has_more?: boolean;
  items?: OnePasswordSignInAttempt[];
}

export class OnePasswordEventsConnector {
  async getSignInAttempts(options: { cursor?: string; limit: number; resetCursor?: boolean }): Promise<OnePasswordSignInResponse> {
    if (!env.hasOnePasswordEventsCredentials) {
      throw new Error("1Password Events API is not configured.");
    }

    const url = new URL(`${env.ONEPASSWORD_EVENTS_BASE_URL}/api/v2/signinattempts`);
    const body: Record<string, any> = { limit: options.limit };
    if (options.resetCursor) {
      body.reset_cursor = true;
    } else if (options.cursor) {
      body.cursor = options.cursor;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.ONEPASSWORD_EVENTS_TOKEN!}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`1Password Events API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as OnePasswordSignInResponse;
  }
}

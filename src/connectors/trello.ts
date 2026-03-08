import { env } from "../config/env";

interface TrelloCardSummary {
  name: string;
  due: string;
  url: string;
}

interface TrelloCard {
  name?: string;
  due?: string | null;
  shortUrl?: string;
  closed?: boolean;
}

export class TrelloConnector {
  async getDueWithin24h(limit = 5): Promise<TrelloCardSummary[]> {
    if (!env.hasTrelloCredentials) {
      throw new Error("Trello is not configured.");
    }

    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const url = new URL(`https://api.trello.com/1/boards/${env.TRELLO_BOARD_ID}/cards`);
    url.searchParams.set("key", env.TRELLO_API_KEY!);
    url.searchParams.set("token", env.TRELLO_API_TOKEN!);
    url.searchParams.set("fields", "name,due,shortUrl,closed");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Trello API error: ${response.status} ${response.statusText}`);
    }

    const cards = (await response.json()) as TrelloCard[];

    return cards
      .filter((card) => !card.closed && !!card.due)
      .map((card) => ({
        name: card.name ?? "(No title)",
        due: card.due!,
        url: card.shortUrl ?? ""
      }))
      .filter((card) => {
        const dueDate = new Date(card.due);
        return dueDate >= now && dueDate <= next24h;
      })
      .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime())
      .slice(0, limit);
  }
}

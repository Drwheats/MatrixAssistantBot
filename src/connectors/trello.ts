import { env } from "../config/env";

export interface TrelloCardSummary {
  id: string;
  name: string;
  due: string;
  url: string;
}

interface TrelloCard {
  id?: string;
  name?: string;
  due?: string | null;
  desc?: string;
  idList?: string;
  shortUrl?: string;
  closed?: boolean;
}

interface TrelloList {
  id?: string;
  name?: string;
  closed?: boolean;
}

export class TrelloConnector {
  private cachedListId: string | null = null;
  private cachedDueFilterListIds: string[] | null = null;

  async getDueWithin24h(limit = 5): Promise<TrelloCardSummary[]> {
    if (!env.hasTrelloCredentials) {
      throw new Error("Trello is not configured.");
    }

    const now = new Date();
    const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const cards = await this.fetchBoardCards();
    const allowedListIds = await this.getDueFilterListIds();

    return cards
      .filter((card) => !card.closed && !!card.due && !!card.idList && allowedListIds.has(card.idList))
      .map((card) => ({
        id: card.id ?? "",
        name: card.name ?? "(No title)",
        due: card.due!,
        url: card.shortUrl ?? ""
      }))
      .filter((card) => {
        const dueDate = new Date(card.due);
        return card.id.length > 0 && dueDate >= now && dueDate <= next24h;
      })
      .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime())
      .slice(0, limit);
  }

  async getDueBetween(start: Date, end: Date, limit = 25): Promise<TrelloCardSummary[]> {
    if (!env.hasTrelloCredentials) {
      throw new Error("Trello is not configured.");
    }

    const cards = await this.fetchBoardCards();

    return cards
      .filter((card) => !card.closed && !!card.due)
      .map((card) => ({
        id: card.id ?? "",
        name: card.name ?? "(No title)",
        due: card.due!,
        url: card.shortUrl ?? ""
      }))
      .filter((card) => {
        const dueDate = new Date(card.due);
        return card.id.length > 0 && dueDate >= start && dueDate <= end;
      })
      .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime())
      .slice(0, limit);
  }

  async getOverdue(limit = 10): Promise<TrelloCardSummary[]> {
    if (!env.hasTrelloCredentials) {
      throw new Error("Trello is not configured.");
    }

    const now = new Date();
    const cards = await this.fetchBoardCards();
    const allowedListIds = await this.getDueFilterListIds();

    return cards
      .filter((card) => !card.closed && !!card.due && !!card.idList && allowedListIds.has(card.idList))
      .map((card) => ({
        id: card.id ?? "",
        name: card.name ?? "(No title)",
        due: card.due!,
        url: card.shortUrl ?? ""
      }))
      .filter((card) => {
        const dueDate = new Date(card.due);
        return card.id.length > 0 && dueDate < now;
      })
      .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime())
      .slice(0, limit);
  }

  async createCard(name: string, due: Date): Promise<TrelloCardSummary> {
    if (!env.hasTrelloCredentials) {
      throw new Error("Trello is not configured.");
    }

    const listId = await this.getTargetListId();
    const body = new URLSearchParams();
    body.set("idList", listId);
    body.set("name", name);
    body.set("due", due.toISOString());

    const url = new URL("https://api.trello.com/1/cards");
    url.searchParams.set("key", env.TRELLO_API_KEY!);
    url.searchParams.set("token", env.TRELLO_API_TOKEN!);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      throw new Error(`Trello API error: ${response.status} ${response.statusText}`);
    }

    const card = (await response.json()) as TrelloCard;
    if (!card.id || !card.due) {
      throw new Error("Trello API error: card creation response missing required fields.");
    }

    return {
      id: card.id,
      name: card.name ?? name,
      due: card.due,
      url: card.shortUrl ?? ""
    };
  }

  async appendCardDescription(cardId: string, text: string): Promise<void> {
    if (!env.hasTrelloCredentials) {
      throw new Error("Trello is not configured.");
    }

    const current = await this.fetchCard(cardId);
    const existing = (current.desc ?? "").trim();
    const incoming = text.trim();
    const next = existing.length > 0 ? `${existing}\n\n${incoming}` : incoming;

    const body = new URLSearchParams();
    body.set("desc", next);

    const url = new URL(`https://api.trello.com/1/cards/${cardId}`);
    url.searchParams.set("key", env.TRELLO_API_KEY!);
    url.searchParams.set("token", env.TRELLO_API_TOKEN!);

    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      throw new Error(`Trello API error: ${response.status} ${response.statusText}`);
    }
  }

  private async fetchBoardCards(): Promise<TrelloCard[]> {
    const url = new URL(`https://api.trello.com/1/boards/${env.TRELLO_BOARD_ID}/cards`);
    url.searchParams.set("key", env.TRELLO_API_KEY!);
    url.searchParams.set("token", env.TRELLO_API_TOKEN!);
    url.searchParams.set("fields", "id,name,due,idList,shortUrl,closed");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Trello API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as TrelloCard[];
  }

  private async getTargetListId(): Promise<string> {
    if (env.TRELLO_DEFAULT_LIST_ID) {
      return env.TRELLO_DEFAULT_LIST_ID;
    }

    if (this.cachedListId) {
      return this.cachedListId;
    }

    const url = new URL(`https://api.trello.com/1/boards/${env.TRELLO_BOARD_ID}/lists`);
    url.searchParams.set("key", env.TRELLO_API_KEY!);
    url.searchParams.set("token", env.TRELLO_API_TOKEN!);
    url.searchParams.set("fields", "id,closed");
    url.searchParams.set("filter", "open");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Trello API error: ${response.status} ${response.statusText}`);
    }

    const lists = (await response.json()) as TrelloList[];
    const firstOpenList = lists.find((list) => !!list.id && !list.closed)?.id;
    if (!firstOpenList) {
      throw new Error("Trello API error: no open list found on configured board.");
    }

    this.cachedListId = firstOpenList;
    return firstOpenList;
  }

  private async getDueFilterListIds(): Promise<Set<string>> {
    if (this.cachedDueFilterListIds) {
      return new Set(this.cachedDueFilterListIds);
    }

    const lists = await this.fetchBoardLists();
    const allowedNames = new Set(["todo", "pending"]);
    const ids = lists
      .filter((list) => !list.closed && !!list.id)
      .filter((list) => allowedNames.has(normalizeListName(list.name ?? "")))
      .map((list) => list.id!);

    this.cachedDueFilterListIds = ids;
    return new Set(ids);
  }

  private async fetchBoardLists(): Promise<TrelloList[]> {
    const url = new URL(`https://api.trello.com/1/boards/${env.TRELLO_BOARD_ID}/lists`);
    url.searchParams.set("key", env.TRELLO_API_KEY!);
    url.searchParams.set("token", env.TRELLO_API_TOKEN!);
    url.searchParams.set("fields", "id,name,closed");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Trello API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as TrelloList[];
  }

  private async fetchCard(cardId: string): Promise<TrelloCard> {
    const url = new URL(`https://api.trello.com/1/cards/${cardId}`);
    url.searchParams.set("key", env.TRELLO_API_KEY!);
    url.searchParams.set("token", env.TRELLO_API_TOKEN!);
    url.searchParams.set("fields", "id,desc");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Trello API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as TrelloCard;
  }
}

function normalizeListName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

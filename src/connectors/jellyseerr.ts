import { env } from "../config/env";

export interface JellyseerrSearchResult {
  id?: number;
  title?: string;
  mediaType?: string;
  releaseDate?: string;
  originalLanguage?: string;
  overview?: string;
}

export interface JellyseerrMovieDetails {
  id?: number;
  title?: string;
  releaseDate?: string;
  originalLanguage?: string;
  overview?: string;
  credits?: {
    crew?: Array<{ job?: string; name?: string }>;
  };
  crew?: Array<{ job?: string; name?: string }>;
  spokenLanguages?: Array<{ englishName?: string; name?: string; iso_639_1?: string }>;
}

interface JellyseerrSearchResponse {
  results?: JellyseerrSearchResult[];
}

export class JellyseerrConnector {
  async search(query: string): Promise<JellyseerrSearchResult[]> {
    if (!env.hasJellyseerrCredentials) {
      throw new Error("Seerr is not configured.");
    }

    const url = this.buildApiUrl("/search");
    const cleanedQuery = query.trim().replace(/\s+/g, " ");
    url.search = `?query=${encodeURIComponent(cleanedQuery)}`;

    const payload = await this.request<JellyseerrSearchResponse>(url.toString());
    return Array.isArray(payload?.results) ? payload.results : [];
  }

  async getMovieDetails(movieId: number): Promise<JellyseerrMovieDetails> {
    if (!env.hasJellyseerrCredentials) {
      throw new Error("Seerr is not configured.");
    }

    const url = this.buildApiUrl(`/movie/${movieId}`);
    return this.request<JellyseerrMovieDetails>(url.toString());
  }

  async requestMovie(mediaId: number): Promise<void> {
    if (!env.hasJellyseerrCredentials) {
      throw new Error("Seerr is not configured.");
    }

    const url = this.buildApiUrl("/request");
    await this.request(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaType: "movie", mediaId })
    });
  }

  private buildApiUrl(path: string): URL {
    const base = env.JELLYSEERR_URL!.replace(/\/+$/, "");
    const apiBase = base.endsWith("/api/v1") ? base : `${base}/api/v1`;
    return new URL(`${apiBase}${path}`);
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    headers.set("X-Api-Key", env.JELLYSEERR_API_KEY!);

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Seerr API error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

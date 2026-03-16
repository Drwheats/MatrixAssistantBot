import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv();

const envSchema = z.object({
  MATRIX_HOMESERVER_URL: z.string().url(),
  MATRIX_ACCESS_TOKEN: z.string().min(1),
  MATRIX_BOT_USER_ID: z.string().min(1),
  MATRIX_ALLOWED_USERS: z.string().default(""),

  GOOGLE_CALENDAR_CLIENT_EMAIL: z.string().email().optional(),
  GOOGLE_CALENDAR_PRIVATE_KEY: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),

  TRELLO_API_KEY: z.string().optional(),
  TRELLO_API_TOKEN: z.string().optional(),
  TRELLO_BOARD_ID: z.string().optional(),
  TRELLO_DEFAULT_LIST_ID: z.string().optional(),

  GRAFANA_URL: z.string().url().optional(),
  GRAFANA_TOKEN: z.string().optional(),
  GRAFANA_LOKI_DATASOURCE_UID: z.string().optional(),
  GRAFANA_LOG_LABEL_SELECTOR: z.string().optional(),
  GRAFANA_INCIDENT_SERVICE_LABEL: z.string().optional(),
  GRAFANA_SECURITY_LOGIN_ALERTS_ENABLED: z.coerce.boolean().optional(),
  GRAFANA_SECURITY_LOGIN_QUERY: z.string().optional(),
  GRAFANA_SECURITY_LOGIN_LABEL_SELECTOR: z.string().optional(),
  GRAFANA_SECURITY_LOGIN_POLL_MS: z.coerce.number().optional(),
  GRAFANA_SECURITY_LOGIN_LOOKBACK_MS: z.coerce.number().optional(),
  GRAFANA_SECURITY_LOGIN_LIMIT: z.coerce.number().optional(),
  GRAFANA_QBITTORRENT_ALERTS_ENABLED: z.coerce.boolean().optional(),
  GRAFANA_QBITTORRENT_POLL_MS: z.coerce.number().optional(),
  GRAFANA_QBITTORRENT_LOOKBACK_MS: z.coerce.number().optional(),
  GRAFANA_QBITTORRENT_LIMIT: z.coerce.number().optional(),

  LLM_STUDIO_BASE_URL: z.string().url().default("http://localhost:1234"),
  LLM_STUDIO_API_KEY: z.string().optional(),
  LLM_STUDIO_MODEL: z.string().optional(),
  LLM_STUDIO_TEMPERATURE: z.coerce.number().optional(),
  LLM_STUDIO_MAX_TOKENS: z.coerce.number().optional(),
  LLM_STUDIO_TIMEOUT_MS: z.coerce.number().optional(),
  LLM_STUDIO_GLOBAL_PROMPT: z.string().optional(),
  LLM_STUDIO_FACTCHECK_PROMPT: z.string().optional(),

  JELLYSEERR_URL: z.string().url().optional(),
  JELLYSEERR_API_KEY: z.string().optional(),

  PORT: z.coerce.number().default(3000)
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const allowedUsers = parsed.data.MATRIX_ALLOWED_USERS
  .split(",")
  .map((u) => u.trim())
  .filter((u) => u.length > 0);

export const env = {
  ...parsed.data,
  allowedUsers,
  hasGoogleCalendarCredentials:
    !!parsed.data.GOOGLE_CALENDAR_CLIENT_EMAIL &&
    !!parsed.data.GOOGLE_CALENDAR_PRIVATE_KEY &&
    !!parsed.data.GOOGLE_CALENDAR_ID,
  hasTrelloCredentials:
    !!parsed.data.TRELLO_API_KEY &&
    !!parsed.data.TRELLO_API_TOKEN &&
    !!parsed.data.TRELLO_BOARD_ID,
  hasGrafanaCredentials:
    !!parsed.data.GRAFANA_URL &&
    !!parsed.data.GRAFANA_TOKEN &&
    !!parsed.data.GRAFANA_LOKI_DATASOURCE_UID,
  hasJellyseerrCredentials: !!parsed.data.JELLYSEERR_URL && !!parsed.data.JELLYSEERR_API_KEY,
  grafanaSecurityLoginEnabled:
    parsed.data.GRAFANA_SECURITY_LOGIN_ALERTS_ENABLED ??
    !!parsed.data.GRAFANA_SECURITY_LOGIN_QUERY,
  grafanaSecurityLoginPollMs: parsed.data.GRAFANA_SECURITY_LOGIN_POLL_MS ?? 15_000,
  grafanaSecurityLoginLookbackMs: parsed.data.GRAFANA_SECURITY_LOGIN_LOOKBACK_MS ?? 5 * 60_000,
  grafanaSecurityLoginLimit: parsed.data.GRAFANA_SECURITY_LOGIN_LIMIT ?? 50,
  grafanaQbittorrentAlertsEnabled: parsed.data.GRAFANA_QBITTORRENT_ALERTS_ENABLED ?? false,
  grafanaQbittorrentPollMs: parsed.data.GRAFANA_QBITTORRENT_POLL_MS ?? 15_000,
  grafanaQbittorrentLookbackMs: parsed.data.GRAFANA_QBITTORRENT_LOOKBACK_MS ?? 5 * 60_000,
  grafanaQbittorrentLimit: parsed.data.GRAFANA_QBITTORRENT_LIMIT ?? 50,
  hasLlmStudioCredentials: !!parsed.data.LLM_STUDIO_MODEL,
  llmStudioTemperature: parsed.data.LLM_STUDIO_TEMPERATURE ?? 0.2,
  llmStudioMaxTokens: parsed.data.LLM_STUDIO_MAX_TOKENS ?? 700,
  llmStudioTimeoutMs: parsed.data.LLM_STUDIO_TIMEOUT_MS ?? 30_000,
  llmStudioGlobalPrompt: parsed.data.LLM_STUDIO_GLOBAL_PROMPT,
  llmStudioFactcheckPrompt: parsed.data.LLM_STUDIO_FACTCHECK_PROMPT
};

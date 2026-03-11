import { MatrixClient } from "matrix-bot-sdk";
import { GoogleCalendarConnector } from "../connectors/googleCalendar";
import { TrelloConnector } from "../connectors/trello";
import { GrafanaConnector } from "../connectors/grafana";
import { LlmStudioConnector } from "../connectors/llmStudio";
import { BotStateStore } from "../services/botStateStore";
import { BotRuntimeConfig } from "../services/botConfig";

export interface CommandContext {
  client: MatrixClient;
  roomId: string;
  sender: string;
  eventId?: string;
  commandBody: string;
  isAllowedUser: boolean;
  isAdminUser: boolean;
  botConfig: BotRuntimeConfig;
  stateStore: BotStateStore;
  googleCalendar: GoogleCalendarConnector;
  trello: TrelloConnector;
  grafana: GrafanaConnector;
  llmStudio: LlmStudioConnector;
}

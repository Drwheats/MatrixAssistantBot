import { MatrixClient } from "matrix-bot-sdk";
import { GoogleCalendarConnector } from "../connectors/googleCalendar";
import { TrelloConnector } from "../connectors/trello";
import { GrafanaConnector } from "../connectors/grafana";
import { LlmStudioConnector } from "../connectors/llmStudio";

export interface CommandContext {
  client: MatrixClient;
  roomId: string;
  sender: string;
  commandBody: string;
  isAllowedUser: boolean;
  googleCalendar: GoogleCalendarConnector;
  trello: TrelloConnector;
  grafana: GrafanaConnector;
  llmStudio: LlmStudioConnector;
}

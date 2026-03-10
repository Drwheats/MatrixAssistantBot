import { AutojoinRoomsMixin, LogLevel, LogService, MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { env } from "./config/env";
import { GoogleCalendarConnector } from "./connectors/googleCalendar";
import { GrafanaConnector } from "./connectors/grafana";
import { TrelloConnector } from "./connectors/trello";
import { routeCommand } from "./commands/router";
import { handleTrelloReplyDescriptionMessage } from "./commands/trello";
import { BotStateStore } from "./services/botStateStore";
import { AnnouncementService } from "./services/announcements";
import { GrafanaAlertsChannelService } from "./services/grafanaAlertsChannel";

LogService.setLevel(LogLevel.ERROR);

const storage = new SimpleFsStorageProvider("bot-storage.json");
const client = new MatrixClient(env.MATRIX_HOMESERVER_URL, env.MATRIX_ACCESS_TOKEN, storage);
AutojoinRoomsMixin.setupOnClient(client);

const googleCalendar = new GoogleCalendarConnector();
const trello = new TrelloConnector();
const grafana = new GrafanaConnector();
const stateStore = new BotStateStore("assistant-state.json");
const announcementService = new AnnouncementService(client, trello, stateStore);
const grafanaAlertsChannelService = new GrafanaAlertsChannelService(client, stateStore);

client.on("room.message", async (roomId: string, event: Record<string, any>) => {
  if (!event?.content || event.content.msgtype !== "m.text") {
    return;
  }

  const sender = event.sender as string;
  if (!sender || sender === env.MATRIX_BOT_USER_ID) {
    return;
  }

  const body = String(event.content.body ?? "").trim();
  const isAllowedUser = env.allowedUsers.length === 0 || env.allowedUsers.includes(sender);

  const handledReply = await handleTrelloReplyDescriptionMessage(
    {
      client,
      roomId,
      sender,
      commandBody: body,
      isAllowedUser,
      googleCalendar,
      trello,
      grafana
    },
    event
  );
  if (handledReply) {
    return;
  }

  if (!body.startsWith("!")) {
    return;
  }

  await routeCommand({
    client,
    roomId,
    sender,
    commandBody: body,
    isAllowedUser,
    googleCalendar,
    trello,
    grafana
  });
});

async function main(): Promise<void> {
  await client.start();
  await grafanaAlertsChannelService.start();
  await announcementService.start();
  console.log(`Matrix Assistant Bot is running as ${env.MATRIX_BOT_USER_ID}`);
}

main().catch((error) => {
  console.error("Fatal error while starting bot:", error);
  process.exit(1);
});

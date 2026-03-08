import { AutojoinRoomsMixin, LogService, MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { env } from "./config/env";
import { GoogleCalendarConnector } from "./connectors/googleCalendar";
import { TrelloConnector } from "./connectors/trello";
import { routeCommand } from "./commands/router";

LogService.setLevel("INFO");

const storage = new SimpleFsStorageProvider("bot-storage.json");
const client = new MatrixClient(env.MATRIX_HOMESERVER_URL, env.MATRIX_ACCESS_TOKEN, storage);
AutojoinRoomsMixin.setupOnClient(client);

const googleCalendar = new GoogleCalendarConnector();
const trello = new TrelloConnector();

client.on("room.message", async (roomId: string, event: Record<string, any>) => {
  if (!event?.content || event.content.msgtype !== "m.text") {
    return;
  }

  const sender = event.sender as string;
  if (!sender || sender === env.MATRIX_BOT_USER_ID) {
    return;
  }

  const body = String(event.content.body ?? "").trim();
  if (!body.startsWith("!")) {
    return;
  }

  const isAllowedUser = env.allowedUsers.length === 0 || env.allowedUsers.includes(sender);

  await routeCommand({
    client,
    roomId,
    sender,
    commandBody: body,
    isAllowedUser,
    googleCalendar,
    trello
  });
});

async function main(): Promise<void> {
  await client.start();
  console.log(`Matrix Assistant Bot is running as ${env.MATRIX_BOT_USER_ID}`);
}

main().catch((error) => {
  console.error("Fatal error while starting bot:", error);
  process.exit(1);
});

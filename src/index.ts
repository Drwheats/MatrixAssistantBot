import { AutojoinRoomsMixin, LogLevel, LogService, MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { env } from "./config/env";
import { GoogleCalendarConnector } from "./connectors/googleCalendar";
import { GrafanaConnector } from "./connectors/grafana";
import { TrelloConnector } from "./connectors/trello";
import { routeCommand } from "./commands/router";
import { handleTrelloReplyDescriptionMessage } from "./commands/trello";
import { handleFactcheckReplyMessage } from "./commands/llmStudio";
import { BotStateStore } from "./services/botStateStore";
import { isAdminUser, isAllowedUser, loadBotConfig } from "./services/botConfig";
import { AnnouncementService } from "./services/announcements";
import { GrafanaAlertsChannelService } from "./services/grafanaAlertsChannel";
import { GrafanaSecurityLoginAlertsService } from "./services/grafanaSecurityLoginAlerts";
import { GrafanaQbittorrentAlertsService } from "./services/grafanaQbittorrentAlerts";
import { GrafanaMonitorAlertsService } from "./services/grafanaMonitorAlerts";
import { LlmStudioConnector } from "./connectors/llmStudio";
import { UserConfigStore } from "./services/userConfigStore";
import { HardwareAlertsService } from "./services/hardwareAlerts";

LogService.setLevel(LogLevel.ERROR);

const storage = new SimpleFsStorageProvider("bot-storage.json");
const client = new MatrixClient(env.MATRIX_HOMESERVER_URL, env.MATRIX_ACCESS_TOKEN, storage);
AutojoinRoomsMixin.setupOnClient(client);

const googleCalendar = new GoogleCalendarConnector();
const trello = new TrelloConnector();
const grafana = new GrafanaConnector();
const llmStudio = new LlmStudioConnector();
const stateStore = new BotStateStore("assistant-state.json");
const userConfigStore = new UserConfigStore("user-config.json");
const announcementService = new AnnouncementService(client, trello, stateStore);
const grafanaAlertsChannelService = new GrafanaAlertsChannelService(client, stateStore);
const grafanaSecurityLoginAlertsService = new GrafanaSecurityLoginAlertsService(
  client,
  grafana,
  grafanaAlertsChannelService,
  stateStore
);
const grafanaQbittorrentAlertsService = new GrafanaQbittorrentAlertsService(
  client,
  grafana,
  grafanaAlertsChannelService,
  stateStore
);
const grafanaMonitorAlertsService = new GrafanaMonitorAlertsService(
  client,
  grafana,
  grafanaAlertsChannelService,
  stateStore,
  userConfigStore
);
const hardwareAlertsService = new HardwareAlertsService(grafanaAlertsChannelService, llmStudio);

client.on("room.message", async (roomId: string, event: Record<string, any>) => {
  if (!event?.content || event.content.msgtype !== "m.text") {
    return;
  }

  const sender = event.sender as string;
  if (!sender || sender === env.MATRIX_BOT_USER_ID) {
    return;
  }

  const body = String(event.content.body ?? "").trim();
  const botConfig = await loadBotConfig(stateStore, userConfigStore);
  const isAllowedUserFlag = isAllowedUser(sender, botConfig);
  const isAdminUserFlag = isAdminUser(sender);

  const handledReply = await handleTrelloReplyDescriptionMessage(
    {
      client,
      roomId,
      sender,
      eventId: event?.event_id,
      commandBody: body,
      isAllowedUser: isAllowedUserFlag,
      isAdminUser: isAdminUserFlag,
      botConfig,
      stateStore,
      userConfigStore,
      alertsChannel: grafanaAlertsChannelService,
      googleCalendar,
      trello,
      grafana,
      llmStudio
    },
    event
  );
  if (handledReply) {
    return;
  }

  const handledFactcheckReply = await handleFactcheckReplyMessage(
    {
      client,
      roomId,
      sender,
      eventId: event?.event_id,
      commandBody: body,
      isAllowedUser: isAllowedUserFlag,
      isAdminUser: isAdminUserFlag,
      botConfig,
      stateStore,
      userConfigStore,
      alertsChannel: grafanaAlertsChannelService,
      googleCalendar,
      trello,
      grafana,
      llmStudio
    },
    event
  );
  if (handledFactcheckReply) {
    return;
  }

  if (!body.startsWith("!")) {
    return;
  }

  await routeCommand({
    client,
    roomId,
    sender,
    eventId: event?.event_id,
    commandBody: body,
    isAllowedUser: isAllowedUserFlag,
    isAdminUser: isAdminUserFlag,
    botConfig,
    stateStore,
    userConfigStore,
    alertsChannel: grafanaAlertsChannelService,
    googleCalendar,
    trello,
    grafana,
    llmStudio
  });
});

client.on("room.event", async (roomId: string, event: Record<string, any>) => {
  if (!event || event.type !== "m.reaction") {
    return;
  }

  const sender = event.sender as string;
  if (!sender || sender === env.MATRIX_BOT_USER_ID) {
    return;
  }

  if (!isAdminUser(sender)) {
    return;
  }

  const relatesTo = event?.content?.["m.relates_to"];
  const reactionKey = relatesTo?.key;
  if (reactionKey !== "👎") {
    return;
  }

  const targetEventId = relatesTo?.event_id;
  if (!targetEventId) {
    return;
  }

  const state = await stateStore.load();
  const monitorIds = state.monitorReviewTargets[targetEventId];
  if (!Array.isArray(monitorIds) || monitorIds.length === 0) {
    return;
  }

  const userConfig = await userConfigStore.load();
  const remaining = userConfig.monitors.filter((monitor) => !monitorIds.includes(monitor.id));
  if (remaining.length === userConfig.monitors.length) {
    return;
  }

  for (const id of monitorIds) {
    delete state.monitorSeenKeys[id];
  }
  delete state.monitorReviewTargets[targetEventId];
  await userConfigStore.save({ monitors: remaining });
  await stateStore.save({
    monitorSeenKeys: state.monitorSeenKeys,
    monitorReviewTargets: state.monitorReviewTargets
  });

  await client.sendMessage(roomId, {
    msgtype: "m.text",
    body: `Stopped monitoring ${monitorIds.length} item(s).`
  });
});

async function main(): Promise<void> {
  await client.start();
  await grafanaAlertsChannelService.start();
  await grafanaSecurityLoginAlertsService.start();
  await grafanaQbittorrentAlertsService.start();
  await grafanaMonitorAlertsService.start();
  await hardwareAlertsService.start();
  await announcementService.start();
  console.log(`Matrix Assistant Bot is running as ${env.MATRIX_BOT_USER_ID}`);
}

main().catch((error) => {
  console.error("Fatal error while starting bot:", error);
  process.exit(1);
});

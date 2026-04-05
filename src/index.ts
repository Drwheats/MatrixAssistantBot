import { AutojoinRoomsMixin, LogLevel, LogService, MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { env } from "./config/env";
import { GoogleCalendarConnector } from "./connectors/googleCalendar";
import { GrafanaConnector } from "./connectors/grafana";
import { JellyseerrConnector } from "./connectors/jellyseerr";
import { TrelloConnector } from "./connectors/trello";
import { routeCommand } from "./commands/router";
import { handleTrelloReplyDescriptionMessage } from "./commands/trello";
import { handleBlimpfDownloadReplyMessage, handleFactcheckReplyMessage } from "./commands/llmStudio";
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
import { SshLoginAlertsService } from "./services/sshLoginAlerts";
import { StartupIntegrationReportService } from "./services/startupIntegrationReport";
import { GithubConnector } from "./connectors/github";
import { GithubAlertsService } from "./services/githubAlerts";
import { QuietHoursService } from "./services/quietHours";

LogService.setLevel(LogLevel.ERROR);

const startupTimestamp = Date.now();

const dataDir = resolve(env.BOT_DATA_DIR?.trim() || join(homedir(), ".matrix-assistant-bot"));
ensureDataDir(dataDir);

const botStoragePath = join(dataDir, "bot-storage.json");
const statePath = join(dataDir, "assistant-state.json");
const userConfigPath = join(dataDir, "user-config.json");

migrateLegacyFile("bot-storage.json", botStoragePath);
migrateLegacyFile("assistant-state.json", statePath);
migrateLegacyFile("user-config.json", userConfigPath);

const storage = new SimpleFsStorageProvider(botStoragePath);
const client = new MatrixClient(env.MATRIX_HOMESERVER_URL, env.MATRIX_ACCESS_TOKEN, storage);
AutojoinRoomsMixin.setupOnClient(client);

const googleCalendar = new GoogleCalendarConnector();
const trello = new TrelloConnector();
const grafana = new GrafanaConnector();
const llmStudio = new LlmStudioConnector();
const jellyseerr = new JellyseerrConnector();
const github = new GithubConnector();
const stateStore = new BotStateStore(statePath);
const userConfigStore = new UserConfigStore(userConfigPath);
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
const sshLoginAlertsService = new SshLoginAlertsService(grafanaAlertsChannelService);
const startupIntegrationReportService = new StartupIntegrationReportService(
  grafanaAlertsChannelService,
  grafana,
  trello,
  googleCalendar,
  llmStudio,
  jellyseerr,
  github
);
const githubAlertsService = new GithubAlertsService(github, grafanaAlertsChannelService, stateStore);

function ensureDataDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

function migrateLegacyFile(legacyFileName: string, targetPath: string): void {
  if (existsSync(targetPath)) {
    return;
  }

  const legacyPath = resolve(process.cwd(), legacyFileName);
  if (legacyPath === targetPath || !existsSync(legacyPath)) {
    return;
  }

  copyFileSync(legacyPath, targetPath);
}

async function isTestingModeEnabled(store: UserConfigStore): Promise<boolean> {
  try {
    const config = await store.load();
    return config.testingMode === true;
  } catch {
    return false;
  }
}

const originalSendMessage = client.sendMessage.bind(client);
const immediateSendContext = new AsyncLocalStorage<{ bypassQuietHours: boolean }>();
const quietHoursService = new QuietHoursService(
  stateStore,
  (roomId: string, content: Record<string, unknown>) => originalSendMessage(roomId, content as any)
);
(client as any).sendMessage = async (...args: Parameters<MatrixClient["sendMessage"]>) => {
  if (await isTestingModeEnabled(userConfigStore)) {
    return;
  }

  const [roomId, content] = args;
  const body = (content as { body?: unknown } | undefined)?.body;
  const msgtype = (content as { msgtype?: unknown } | undefined)?.msgtype;
  const bypassQuietHours = immediateSendContext.getStore()?.bypassQuietHours === true;
  if (bypassQuietHours) {
    return originalSendMessage(...args);
  }
  if (typeof roomId === "string" && typeof body === "string" && msgtype === "m.text") {
    return quietHoursService.sendText(roomId, body, content as Record<string, unknown>);
  }

  return originalSendMessage(...args);
};

const originalSendEvent = client.sendEvent.bind(client);
(client as any).sendEvent = async (...args: Parameters<MatrixClient["sendEvent"]>) => {
  if (args[1] === "m.reaction" && (await isTestingModeEnabled(userConfigStore))) {
    return;
  }
  return originalSendEvent(...args);
};

client.on("room.message", async (roomId: string, event: Record<string, any>) => {
  await immediateSendContext.run({ bypassQuietHours: true }, async () => {
  if (!event?.content || event.content.msgtype !== "m.text") {
    return;
  }

  const eventTimestamp = typeof event.origin_server_ts === "number" ? event.origin_server_ts : null;
  if (eventTimestamp !== null && eventTimestamp < startupTimestamp - 5_000) {
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
      llmStudio,
      jellyseerr,
      github
    },
    event
  );
  if (handledReply) {
    return;
  }

  const handledSeerrReply = await handleBlimpfDownloadReplyMessage(
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
      llmStudio,
      jellyseerr,
      github
    },
    event
  );
  if (handledSeerrReply) {
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
      llmStudio,
      jellyseerr,
      github
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
    llmStudio,
    jellyseerr,
    github
  });
  });
});

client.on("room.event", async (roomId: string, event: Record<string, any>) => {
  await immediateSendContext.run({ bypassQuietHours: true }, async () => {
  if (!event || event.type !== "m.reaction") {
    return;
  }

  const eventTimestamp = typeof event.origin_server_ts === "number" ? event.origin_server_ts : null;
  if (eventTimestamp !== null && eventTimestamp < startupTimestamp - 5_000) {
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
  const targetEventId = relatesTo?.event_id;
  if (!targetEventId) {
    return;
  }

  if (reactionKey === "❓" || reactionKey === "?") {
    const state = await stateStore.load();
    const errorMessage = state.errorReactionTargets?.[targetEventId];
    if (!errorMessage) {
      return;
    }

    await client.sendMessage(roomId, {
      msgtype: "m.text",
      body: errorMessage,
      "m.relates_to": {
        "m.in_reply_to": {
          event_id: targetEventId
        }
      }
    });

    const nextTargets = { ...state.errorReactionTargets };
    delete nextTargets[targetEventId];
    await stateStore.save({ errorReactionTargets: nextTargets });
    return;
  }

  if (reactionKey === "👎") {
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
    return;
  }

  if (reactionKey === "✅" || reactionKey === "💤") {
    const state = await stateStore.load();
    const cardId = state.trelloAlertTargets?.[targetEventId];
    if (!cardId) {
      return;
    }

    try {
      if (reactionKey === "✅") {
        await trello.moveCardToListByName(cardId, "Done");
        await client.sendMessage(roomId, {
          msgtype: "m.text",
          body: "Trello card moved to Done."
        });
      } else {
        await trello.snoozeCard(cardId, 1);
        await client.sendMessage(roomId, {
          msgtype: "m.text",
          body: "Trello card snoozed for 1 hour."
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await client.sendMessage(roomId, {
        msgtype: "m.text",
        body: `Trello update failed: ${message}`
      });
    }

    delete state.trelloAlertTargets[targetEventId];
    await stateStore.save({ trelloAlertTargets: state.trelloAlertTargets });
  }
  });
});

async function main(): Promise<void> {
  console.log(`Using bot data dir: ${dataDir}`);
  await client.start();
  await quietHoursService.start();
  await grafanaAlertsChannelService.start();
  await grafanaSecurityLoginAlertsService.start();
  await grafanaQbittorrentAlertsService.start();
  await grafanaMonitorAlertsService.start();
  await githubAlertsService.start();
  await hardwareAlertsService.start();
  await sshLoginAlertsService.start();
  await announcementService.start();
  try {
    await startupIntegrationReportService.postStartupReport();
  } catch (error) {
    console.error("Failed to send startup integration report:", error);
  }
  console.log(`Matrix Assistant Bot is running as ${env.MATRIX_BOT_USER_ID}`);
}

main().catch((error) => {
  console.error("Fatal error while starting bot:", error);
  process.exit(1);
});

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface BotState {
  announcementRoomId?: string;
  grafanaAlertsRoomId?: string;
  lastWeeklyAnnouncementISO?: string;
  sentReminderKeys: string[];
  securityLoginSeenKeys: string[];
  qbittorrentSeenKeys: string[];
  botDisplayName?: string;
  promptCommand?: string;
  openMode?: boolean;
  extraAllowedUsers: string[];
  globalPrompt?: string;
  globalFactcheckPrompt?: string;
  qbittorrentLabelSelector?: string;
  monitors: MonitorDefinition[];
  monitorSeenKeys: Record<string, string[]>;
  monitorHistory: MonitorHistoryEntry[];
  monitorReviewTargets: Record<string, string[]>;
  monitorLastList: Record<string, string[]>;
  trelloAlertTargets: Record<string, string>;
  lastWeekdaySummaryISO?: string;
  weatherLocationName?: string;
  weatherLocationLat?: number;
  weatherLocationLon?: number;
  weatherLocationTimezone?: string;
  seerrRequestTargets: Record<string, SeerrRequestTarget>;
  seerrRequestOrder: string[];
  seerrAllowedUsers: string[];
  errorReactionTargets: Record<string, string>;
  githubIssueSeenKeys: string[];
  githubPullSeenKeys: string[];
  githubFailedRunSeenKeys: string[];
  deferredMessages: DeferredMessage[];
  lastDeferredFlushISO?: string;
}

export interface DeferredMessage {
  roomId: string;
  body: string;
  queuedAtISO: string;
}

export interface MonitorDefinition {
  id: string;
  name: string;
  selector: string;
  pattern: string;
  createdAt: string;
}

export interface MonitorHistoryEntry {
  id: string;
  name: string;
  command: string;
  createdAt: string;
}

export interface SeerrRequestTarget {
  createdAt: string;
  items: Array<{ id: number; title: string; mediaType: "movie" | "tv" }>;
}

const DEFAULT_STATE: BotState = {
  sentReminderKeys: [],
  securityLoginSeenKeys: [],
  qbittorrentSeenKeys: [],
  extraAllowedUsers: [],
  monitors: [],
  monitorSeenKeys: {},
  monitorHistory: [],
  monitorReviewTargets: {},
  monitorLastList: {},
  trelloAlertTargets: {},
  seerrRequestTargets: {},
  seerrRequestOrder: [],
  seerrAllowedUsers: [],
  errorReactionTargets: {},
  githubIssueSeenKeys: [],
  githubPullSeenKeys: [],
  githubFailedRunSeenKeys: [],
  deferredMessages: []
};

export class BotStateStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<BotState> {
    if (!existsSync(this.filePath)) {
      return { ...DEFAULT_STATE };
    }

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<BotState>;
      return {
        announcementRoomId: parsed.announcementRoomId,
        grafanaAlertsRoomId: parsed.grafanaAlertsRoomId,
        lastWeeklyAnnouncementISO: parsed.lastWeeklyAnnouncementISO,
        sentReminderKeys: Array.isArray(parsed.sentReminderKeys) ? parsed.sentReminderKeys : [],
        securityLoginSeenKeys: Array.isArray(parsed.securityLoginSeenKeys) ? parsed.securityLoginSeenKeys : [],
        qbittorrentSeenKeys: Array.isArray(parsed.qbittorrentSeenKeys) ? parsed.qbittorrentSeenKeys : [],
        botDisplayName: typeof parsed.botDisplayName === "string" ? parsed.botDisplayName : undefined,
        promptCommand: typeof parsed.promptCommand === "string" ? parsed.promptCommand : undefined,
        openMode: typeof parsed.openMode === "boolean" ? parsed.openMode : undefined,
        extraAllowedUsers: Array.isArray(parsed.extraAllowedUsers) ? parsed.extraAllowedUsers : [],
        globalPrompt: typeof parsed.globalPrompt === "string" ? parsed.globalPrompt : undefined,
        globalFactcheckPrompt:
          typeof parsed.globalFactcheckPrompt === "string" ? parsed.globalFactcheckPrompt : undefined,
        qbittorrentLabelSelector:
          typeof parsed.qbittorrentLabelSelector === "string" ? parsed.qbittorrentLabelSelector : undefined,
        monitors: Array.isArray(parsed.monitors) ? (parsed.monitors as MonitorDefinition[]) : [],
        monitorSeenKeys: isRecordOfStringArray(parsed.monitorSeenKeys) ? parsed.monitorSeenKeys : {},
        monitorHistory: Array.isArray(parsed.monitorHistory)
          ? (parsed.monitorHistory as MonitorHistoryEntry[])
          : [],
        monitorReviewTargets: isRecordOfStringArray(parsed.monitorReviewTargets)
          ? parsed.monitorReviewTargets
          : {},
        monitorLastList: isRecordOfStringArray(parsed.monitorLastList) ? parsed.monitorLastList : {},
        trelloAlertTargets: isRecordOfString(parsed.trelloAlertTargets) ? parsed.trelloAlertTargets : {},
        lastWeekdaySummaryISO: typeof parsed.lastWeekdaySummaryISO === "string" ? parsed.lastWeekdaySummaryISO : undefined,
        weatherLocationName: typeof parsed.weatherLocationName === "string" ? parsed.weatherLocationName : undefined,
        weatherLocationLat: typeof parsed.weatherLocationLat === "number" ? parsed.weatherLocationLat : undefined,
        weatherLocationLon: typeof parsed.weatherLocationLon === "number" ? parsed.weatherLocationLon : undefined,
        weatherLocationTimezone:
          typeof parsed.weatherLocationTimezone === "string" ? parsed.weatherLocationTimezone : undefined,
        seerrRequestTargets: isRecordOfSeerrTarget(parsed.seerrRequestTargets) ? parsed.seerrRequestTargets : {},
        seerrRequestOrder: Array.isArray(parsed.seerrRequestOrder) ? parsed.seerrRequestOrder : [],
        seerrAllowedUsers: Array.isArray(parsed.seerrAllowedUsers) ? parsed.seerrAllowedUsers : [],
        errorReactionTargets: isRecordOfString(parsed.errorReactionTargets) ? parsed.errorReactionTargets : {},
        githubIssueSeenKeys: Array.isArray(parsed.githubIssueSeenKeys) ? parsed.githubIssueSeenKeys : [],
        githubPullSeenKeys: Array.isArray(parsed.githubPullSeenKeys) ? parsed.githubPullSeenKeys : [],
        githubFailedRunSeenKeys: Array.isArray(parsed.githubFailedRunSeenKeys) ? parsed.githubFailedRunSeenKeys : [],
        deferredMessages: Array.isArray(parsed.deferredMessages) ? parsed.deferredMessages.filter(isDeferredMessage) : [],
        lastDeferredFlushISO:
          typeof parsed.lastDeferredFlushISO === "string" ? parsed.lastDeferredFlushISO : undefined
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  async save(state: Partial<BotState>): Promise<void> {
    const current = await this.load();
    const sentReminderKeys = Array.isArray(state.sentReminderKeys) ? state.sentReminderKeys : [];
    const securityLoginSeenKeys = Array.isArray(state.securityLoginSeenKeys) ? state.securityLoginSeenKeys : [];
    const qbittorrentSeenKeys = Array.isArray(state.qbittorrentSeenKeys) ? state.qbittorrentSeenKeys : [];
    const extraAllowedUsers = Array.isArray(state.extraAllowedUsers) ? state.extraAllowedUsers : undefined;
    const monitors = Array.isArray(state.monitors) ? state.monitors : undefined;
    const monitorSeenKeys = isRecordOfStringArray(state.monitorSeenKeys) ? state.monitorSeenKeys : undefined;
    const monitorHistory = Array.isArray(state.monitorHistory) ? state.monitorHistory : undefined;
    const monitorReviewTargets = isRecordOfStringArray(state.monitorReviewTargets)
      ? state.monitorReviewTargets
      : undefined;
    const monitorLastList = isRecordOfStringArray(state.monitorLastList) ? state.monitorLastList : undefined;
    const trelloAlertTargets = isRecordOfString(state.trelloAlertTargets) ? state.trelloAlertTargets : undefined;
    const seerrRequestTargets = isRecordOfSeerrTarget(state.seerrRequestTargets)
      ? state.seerrRequestTargets
      : undefined;
    const seerrRequestOrder = Array.isArray(state.seerrRequestOrder) ? state.seerrRequestOrder : undefined;
    const seerrAllowedUsers = Array.isArray(state.seerrAllowedUsers) ? state.seerrAllowedUsers : undefined;
    const errorReactionTargets = isRecordOfString(state.errorReactionTargets) ? state.errorReactionTargets : undefined;
    const githubIssueSeenKeys = Array.isArray(state.githubIssueSeenKeys) ? state.githubIssueSeenKeys : [];
    const githubPullSeenKeys = Array.isArray(state.githubPullSeenKeys) ? state.githubPullSeenKeys : [];
    const githubFailedRunSeenKeys = Array.isArray(state.githubFailedRunSeenKeys) ? state.githubFailedRunSeenKeys : [];
    const deferredMessages = Array.isArray(state.deferredMessages) ? state.deferredMessages.filter(isDeferredMessage) : undefined;
    const merged: BotState = {
      announcementRoomId: state.announcementRoomId ?? current.announcementRoomId,
      grafanaAlertsRoomId: state.grafanaAlertsRoomId ?? current.grafanaAlertsRoomId,
      lastWeeklyAnnouncementISO: latestISO(state.lastWeeklyAnnouncementISO, current.lastWeeklyAnnouncementISO),
      sentReminderKeys: mergeUnique(current.sentReminderKeys, sentReminderKeys, 5000),
      securityLoginSeenKeys: mergeUnique(current.securityLoginSeenKeys, securityLoginSeenKeys, 5000),
      qbittorrentSeenKeys: mergeUnique(current.qbittorrentSeenKeys, qbittorrentSeenKeys, 5000),
      botDisplayName: state.botDisplayName ?? current.botDisplayName,
      promptCommand: state.promptCommand ?? current.promptCommand,
      openMode: state.openMode ?? current.openMode,
      extraAllowedUsers: extraAllowedUsers ?? current.extraAllowedUsers ?? [],
      globalPrompt: state.globalPrompt ?? current.globalPrompt,
      globalFactcheckPrompt: state.globalFactcheckPrompt ?? current.globalFactcheckPrompt,
      qbittorrentLabelSelector: state.qbittorrentLabelSelector ?? current.qbittorrentLabelSelector,
      monitors: monitors ?? current.monitors ?? [],
      monitorSeenKeys: monitorSeenKeys ?? current.monitorSeenKeys ?? {},
      monitorHistory: monitorHistory ?? current.monitorHistory ?? [],
      monitorReviewTargets: monitorReviewTargets ?? current.monitorReviewTargets ?? {},
      monitorLastList: monitorLastList ?? current.monitorLastList ?? {},
      trelloAlertTargets: trelloAlertTargets ?? current.trelloAlertTargets ?? {},
      lastWeekdaySummaryISO: latestISO(state.lastWeekdaySummaryISO, current.lastWeekdaySummaryISO),
      weatherLocationName: state.weatherLocationName ?? current.weatherLocationName,
      weatherLocationLat: state.weatherLocationLat ?? current.weatherLocationLat,
      weatherLocationLon: state.weatherLocationLon ?? current.weatherLocationLon,
      weatherLocationTimezone: state.weatherLocationTimezone ?? current.weatherLocationTimezone,
      seerrRequestTargets: seerrRequestTargets ?? current.seerrRequestTargets ?? {},
      seerrRequestOrder: seerrRequestOrder ?? current.seerrRequestOrder ?? [],
      seerrAllowedUsers: seerrAllowedUsers ?? current.seerrAllowedUsers ?? [],
      errorReactionTargets: errorReactionTargets ?? current.errorReactionTargets ?? {},
      githubIssueSeenKeys: mergeUnique(current.githubIssueSeenKeys ?? [], githubIssueSeenKeys, 5000),
      githubPullSeenKeys: mergeUnique(current.githubPullSeenKeys ?? [], githubPullSeenKeys, 5000),
      githubFailedRunSeenKeys: mergeUnique(current.githubFailedRunSeenKeys ?? [], githubFailedRunSeenKeys, 5000),
      deferredMessages: deferredMessages ?? current.deferredMessages ?? [],
      lastDeferredFlushISO: latestISO(state.lastDeferredFlushISO, current.lastDeferredFlushISO)
    };

    await writeFile(this.filePath, JSON.stringify(merged, null, 2), "utf8");
  }
}

function mergeUnique(existing: string[], incoming: string[], limit: number): string[] {
  if (existing.length === 0) {
    return incoming.slice(-limit);
  }

  const set = new Set(existing);
  for (const value of incoming) {
    set.add(value);
  }

  const merged = [...set];
  return merged.length > limit ? merged.slice(-limit) : merged;
}

function latestISO(primary?: string, fallback?: string): string | undefined {
  if (primary && fallback) {
    return new Date(primary) >= new Date(fallback) ? primary : fallback;
  }

  return primary ?? fallback;
}

function isRecordOfStringArray(value: unknown): value is Record<string, string[]> {
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const entry of Object.values(value)) {
    if (!Array.isArray(entry)) {
      return false;
    }
  }
  return true;
}

function isRecordOfString(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const entry of Object.values(value)) {
    if (typeof entry !== "string") {
      return false;
    }
  }
  return true;
}

function isRecordOfSeerrTarget(value: unknown): value is Record<string, SeerrRequestTarget> {
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const entry of Object.values(value)) {
    if (!isSeerrTarget(entry)) {
      return false;
    }
  }
  return true;
}

function isSeerrTarget(value: unknown): value is SeerrRequestTarget {
  if (!value || typeof value !== "object") {
    return false;
  }
  const target = value as SeerrRequestTarget;
  if (typeof target.createdAt !== "string") {
    return false;
  }
  if (!Array.isArray(target.items)) {
    return false;
  }
  for (const item of target.items) {
    if (!item || typeof item !== "object") {
      return false;
    }
    if (typeof (item as { id?: number }).id !== "number") {
      return false;
    }
    if (typeof (item as { title?: string }).title !== "string") {
      return false;
    }
    if (!["movie", "tv"].includes((item as { mediaType?: string }).mediaType ?? "")) {
      return false;
    }
  }
  return true;
}

function isDeferredMessage(value: unknown): value is DeferredMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as DeferredMessage;
  return (
    typeof message.roomId === "string" &&
    typeof message.body === "string" &&
    typeof message.queuedAtISO === "string"
  );
}

import { env } from "../config/env";
import { BotStateStore } from "./botStateStore";
import { UserConfigStore } from "./userConfigStore";
import { getWeatherLocation, WeatherLocation } from "./weatherLocation";

export interface BotRuntimeConfig {
  botDisplayName?: string;
  promptCommand: string;
  openMode: boolean;
  extraAllowedUsers: string[];
  globalPrompt?: string;
  globalFactcheckPrompt?: string;
  qbittorrentLabelSelector?: string;
  monitorPrompt?: string;
  weatherLocation: WeatherLocation;
}

export const DEFAULT_PROMPT_COMMAND = "!blimpf";
export const DEFAULT_MONITOR_PROMPT =
  "You are a sysadmin and network monitoring specialist. You must create a short regex that matches similar logs while ignoring timestamps, numeric ids, ports, and IP addresses. Focus on the stable keywords and phrasing.";

export async function loadBotConfig(
  stateStore: BotStateStore,
  userConfigStore: UserConfigStore
): Promise<BotRuntimeConfig> {
  const state = await stateStore.load();
  const userConfig = await userConfigStore.load();
  const promptCommand = normalizePromptCommand(state.promptCommand) ?? DEFAULT_PROMPT_COMMAND;
  const globalPrompt =
    normalizePromptText(userConfig.globalPrompt) ??
    normalizePromptText(state.globalPrompt) ??
    normalizePromptText(env.llmStudioGlobalPrompt);
  const globalFactcheckPrompt =
    normalizePromptText(userConfig.globalFactcheckPrompt) ??
    normalizePromptText(state.globalFactcheckPrompt) ??
    normalizePromptText(env.llmStudioFactcheckPrompt);
  const monitorPrompt =
    normalizePromptText(userConfig.monitorPrompt) ?? DEFAULT_MONITOR_PROMPT;
  return {
    botDisplayName: state.botDisplayName,
    promptCommand,
    openMode: state.openMode ?? false,
    extraAllowedUsers: Array.isArray(state.extraAllowedUsers) ? state.extraAllowedUsers : [],
    globalPrompt,
    globalFactcheckPrompt,
    qbittorrentLabelSelector: normalizeLabelSelector(state.qbittorrentLabelSelector),
    monitorPrompt,
    weatherLocation: getWeatherLocation(state)
  };
}

export function isAdminUser(sender: string): boolean {
  return env.allowedUsers.includes(sender);
}

export function isAllowedUser(sender: string, config: BotRuntimeConfig): boolean {
  if (config.openMode) {
    return true;
  }

  if (env.allowedUsers.length === 0) {
    return true;
  }

  if (env.allowedUsers.includes(sender)) {
    return true;
  }

  return config.extraAllowedUsers.includes(sender);
}

export function normalizePromptCommand(command?: string): string | null {
  if (!command) {
    return null;
  }
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.startsWith("!")) {
    return null;
  }
  if (/\s/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function normalizePromptText(prompt?: string): string | undefined {
  if (typeof prompt !== "string") {
    return undefined;
  }
  const trimmed = prompt.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeLabelSelector(selector?: string): string | undefined {
  if (typeof selector !== "string") {
    return undefined;
  }
  const trimmed = selector.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

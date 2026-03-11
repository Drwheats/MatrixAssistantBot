import { env } from "../config/env";
import { BotStateStore } from "./botStateStore";

export interface BotRuntimeConfig {
  botDisplayName?: string;
  promptCommand: string;
  openMode: boolean;
  extraAllowedUsers: string[];
}

export const DEFAULT_PROMPT_COMMAND = "!blimpf";

export async function loadBotConfig(stateStore: BotStateStore): Promise<BotRuntimeConfig> {
  const state = await stateStore.load();
  const promptCommand = normalizePromptCommand(state.promptCommand) ?? DEFAULT_PROMPT_COMMAND;
  return {
    botDisplayName: state.botDisplayName,
    promptCommand,
    openMode: state.openMode ?? false,
    extraAllowedUsers: Array.isArray(state.extraAllowedUsers) ? state.extraAllowedUsers : []
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

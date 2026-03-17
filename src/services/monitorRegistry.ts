import { CommandContext } from "../types/commandContext";
import { deriveMonitorPattern } from "./monitorPatternGenerator";
import { BotState } from "./botStateStore";

const GLOBAL_MONITOR_SELECTOR = "{}";

export interface SaveMonitorFromSampleOptions {
  rawCommand: string;
  preferredName?: string;
}

export interface SavedMonitorResult {
  name: string;
  pattern: string;
}

export async function saveMonitorFromSample(
  ctx: CommandContext,
  sample: string,
  options: SaveMonitorFromSampleOptions
): Promise<SavedMonitorResult | null> {
  if (!ctx.llmStudio || !ctx.isAllowedUser) {
    return null;
  }

  const pattern = await deriveMonitorPattern(sample, {
    customPrompt: ctx.botConfig.monitorPrompt,
    model: ctx.botConfig.llmModel
  });
  if (!pattern) {
    return null;
  }

  const selector = GLOBAL_MONITOR_SELECTOR;
  const monitorName = normalizeMonitorName(options.preferredName) ?? buildMonitorName(pattern, sample);
  const state = await ctx.stateStore.load();
  const userConfig = await ctx.userConfigStore.load();
  const existing = options.preferredName
    ? userConfig.monitors.find((monitor) => monitor.name.toLowerCase() === monitorName.toLowerCase())
    : userConfig.monitors.find(
        (monitor) => monitor.selector === selector && monitor.pattern === pattern
      );

  if (existing) {
    existing.name = monitorName;
    existing.selector = selector;
    existing.pattern = pattern;
    state.monitorSeenKeys[existing.id] = [];
    recordMonitorHistory(state, existing.id, monitorName, options.rawCommand);
    await ctx.userConfigStore.save({ monitors: userConfig.monitors });
    await ctx.stateStore.save({ monitorSeenKeys: state.monitorSeenKeys, monitorHistory: state.monitorHistory });
    return { name: monitorName, pattern };
  }

  const id = randomId();
  userConfig.monitors.push({
    id,
    name: monitorName,
    selector,
    pattern,
    createdAt: new Date().toISOString()
  });
  state.monitorSeenKeys[id] = [];
  recordMonitorHistory(state, id, monitorName, options.rawCommand);
  await ctx.userConfigStore.save({ monitors: userConfig.monitors });
  await ctx.stateStore.save({ monitorSeenKeys: state.monitorSeenKeys, monitorHistory: state.monitorHistory });
  return { name: monitorName, pattern };
}

export function buildMonitorName(pattern: string, sample: string): string {
  const patternPreview = pattern
    .replace(/\\b/g, "")
    .replace(/\\d\+/g, "N")
    .replace(/\\\[[^\]]*\\\]/g, "")
    .replace(/\(\?:/g, "(")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  const candidate = patternPreview || sample.trim();
  if (!candidate) {
    return "monitor";
  }

  return candidate.length > 60 ? `${candidate.slice(0, 57).trimEnd()}...` : candidate;
}

function normalizeMonitorName(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function recordMonitorHistory(state: BotState, id: string, name: string, rawCommand: string): void {
  const entry = {
    id,
    name,
    command: rawCommand,
    createdAt: new Date().toISOString()
  };
  state.monitorHistory = [...state.monitorHistory, entry].slice(-50);
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

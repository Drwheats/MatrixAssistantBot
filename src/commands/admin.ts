import { CommandContext } from "../types/commandContext";
import { env } from "../config/env";
import { normalizeLabelSelector, normalizePromptCommand, normalizePromptText } from "../services/botConfig";
import { BotState } from "../services/botStateStore";

const ADMIN_PREFIX = "!admin";

export async function handleAdminCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAdminUser) {
    const reason =
      env.allowedUsers.length === 0
        ? "Admin commands are disabled because MATRIX_ALLOWED_USERS is empty."
        : "You are not allowed to use admin commands.";
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: reason
    });
    return;
  }

  const args = ctx.commandBody.trim().slice(ADMIN_PREFIX.length).trim();
  if (!args || args.toLowerCase() === "help") {
    await sendAdminHelp(ctx);
    return;
  }

  if (args.toLowerCase().startsWith("rename ")) {
    await handleRename(ctx, args.slice("rename ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("command ")) {
    await handlePromptCommand(ctx, args.slice("command ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("allow ")) {
    await handleAllowUser(ctx, args.slice("allow ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("deny ")) {
    await handleDenyUser(ctx, args.slice("deny ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("open ")) {
    await handleOpenMode(ctx, args.slice("open ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("setglobalprompt ")) {
    await handleSetGlobalPrompt(ctx, args.slice("setglobalprompt ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("setglobalfactcheckprompt ")) {
    await handleSetGlobalFactcheckPrompt(ctx, args.slice("setglobalfactcheckprompt ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("setqbitlabel ")) {
    await handleSetQbitLabel(ctx, args.slice("setqbitlabel ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("addqbitlabel ")) {
    await handleAddQbitLabel(ctx, args.slice("addqbitlabel ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("clearqbitlabel")) {
    await handleClearQbitLabel(ctx);
    return;
  }

  if (args.toLowerCase().startsWith("monitor ")) {
    await handleAddMonitor(ctx, args.slice("monitor ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("monitorlabel ")) {
    await handleAddMonitorLabel(ctx, args.slice("monitorlabel ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("unmonitor ")) {
    await handleRemoveMonitor(ctx, args.slice("unmonitor ".length).trim());
    return;
  }

  if (args.toLowerCase() === "monitors") {
    await handleListMonitors(ctx);
    return;
  }

  if (
    args.toLowerCase().startsWith("showmonitoring") ||
    args.toLowerCase().startsWith("showmonitor") ||
    args.toLowerCase().startsWith("monitor show")
  ) {
    await handleShowMonitoring(ctx, args);
    return;
  }

  if (args.toLowerCase() === "status") {
    await handleStatus(ctx);
    return;
  }

  await sendAdminHelp(ctx);
}

async function handleRename(ctx: CommandContext, args: string): Promise<void> {
  const parsed = parseRenameArgs(args);
  if (!parsed) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: 'Usage: !admin rename "NAME" [!command]'
    });
    return;
  }

  const { name, command } = parsed;
  try {
    await ctx.client.setDisplayName(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Failed to update display name: ${message}`
    });
    return;
  }

  const updates: { botDisplayName: string; promptCommand?: string } = { botDisplayName: name };
  if (command) {
    updates.promptCommand = command;
  }
  await ctx.stateStore.save(updates);

  const confirmation = command
    ? `Bot renamed to "${name}" and prompt command set to ${command}.`
    : `Bot renamed to "${name}".`;
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: confirmation
  });
}

async function handlePromptCommand(ctx: CommandContext, rawCommand: string): Promise<void> {
  const normalized = normalizePromptCommand(rawCommand);
  if (!normalized) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Usage: !admin command !name (no spaces)."
    });
    return;
  }

  await ctx.stateStore.save({ promptCommand: normalized });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `Prompt command updated to ${normalized}.`
  });
}

async function handleAllowUser(ctx: CommandContext, rawUser: string): Promise<void> {
  const userId = normalizeUserId(rawUser);
  if (!userId) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Usage: !admin allow @user:server"
    });
    return;
  }

  const current = ctx.botConfig.extraAllowedUsers;
  if (current.includes(userId)) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `${userId} is already allowed.`
    });
    return;
  }

  const updated = [...current, userId];
  await ctx.stateStore.save({ extraAllowedUsers: updated });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `${userId} can now use integration commands.`
  });
}

async function handleDenyUser(ctx: CommandContext, rawUser: string): Promise<void> {
  const userId = normalizeUserId(rawUser);
  if (!userId) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Usage: !admin deny @user:server"
    });
    return;
  }

  const current = ctx.botConfig.extraAllowedUsers;
  if (!current.includes(userId)) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `${userId} is not in the allowed list.`
    });
    return;
  }

  const updated = current.filter((id) => id !== userId);
  await ctx.stateStore.save({ extraAllowedUsers: updated });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `${userId} has been removed from the allowed list.`
  });
}

async function handleOpenMode(ctx: CommandContext, arg: string): Promise<void> {
  const normalized = arg.trim().toLowerCase();
  if (normalized === "on") {
    await ctx.stateStore.save({ openMode: true });
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Open mode is now ON. Anyone in rooms with the bot can use integration commands."
    });
    return;
  }

  if (normalized === "off") {
    await ctx.stateStore.save({ openMode: false });
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Open mode is now OFF. Only allowed users can use integration commands."
    });
    return;
  }

  if (normalized === "status") {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Open mode is ${ctx.botConfig.openMode ? "ON" : "OFF"}.`
    });
    return;
  }

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: "Usage: !admin open on|off|status"
  });
}

async function handleStatus(ctx: CommandContext): Promise<void> {
  const allowedUsers = env.allowedUsers.length > 0 ? env.allowedUsers.join(", ") : "(none)";
  const extraUsers = ctx.botConfig.extraAllowedUsers.length > 0 ? ctx.botConfig.extraAllowedUsers.join(", ") : "(none)";
  const globalPrompt = ctx.botConfig.globalPrompt ? "set" : "(unset)";
  const globalFactcheckPrompt = ctx.botConfig.globalFactcheckPrompt ? "set" : "(unset)";
  const qbitLabel = ctx.botConfig.qbittorrentLabelSelector ?? "(default)";
  const lines = [
    `Bot display name: ${ctx.botConfig.botDisplayName ?? "(unchanged)"}`,
    `Prompt command: ${ctx.botConfig.promptCommand}`,
    `Open mode: ${ctx.botConfig.openMode ? "ON" : "OFF"}`,
    `Admin users (.env): ${allowedUsers}`,
    `Extra allowed users: ${extraUsers}`,
    `Global prompt: ${globalPrompt}`,
    `Global factcheck prompt: ${globalFactcheckPrompt}`,
    `Qbittorrent label selector: ${qbitLabel}`
  ];

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });
}

async function sendAdminHelp(ctx: CommandContext): Promise<void> {
  const lines = [
    "Admin commands:",
    '!admin rename "NAME" [!command] - rename the bot and optionally the prompt command',
    "!admin command !name - set the prompt command",
    "!admin allow @user:server - allow a new user",
    "!admin deny @user:server - revoke a user",
    "!admin open on|off|status - toggle open mode",
    '!admin setglobalprompt "PROMPT" - set default LLM prompt (use "clear" to reset)',
    '!admin setglobalfactcheckprompt "PROMPT" - set factcheck prompt (use "clear" to reset)',
    '!admin setqbitlabel "{label=\\"value\\"}" - set qbittorrent label selector',
    "!admin addqbitlabel key=value - add/overwrite a qbittorrent label selector pair",
    "!admin clearqbitlabel - reset qbittorrent label selector",
    '!admin monitor "container" "sample log" - add a Grafana log monitor',
    "!admin monitorlabel name key=value - add/overwrite label selector for a monitor",
    "!admin showmonitoring [N] - list recent monitor commands",
    "!admin showmonitor [N] - same as showmonitoring",
    "!admin monitor show [N] - same as showmonitoring",
    "!admin unmonitor N - remove monitor by number from last list",
    "!admin unmonitor name - remove a monitor by name",
    "!admin monitors - list active monitors",
    "!admin status - show current settings"
  ];

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });
}

function parseRenameArgs(args: string): { name: string; command?: string } | null {
  if (!args) {
    return null;
  }

  if (args.startsWith("\"")) {
    const match = args.match(/^"([^"]+)"(?:\s+(!\S+))?$/);
    if (!match) {
      return null;
    }
    const name = match[1].trim();
    const rawCommand = match[2] ?? undefined;
    if (rawCommand) {
      const normalized = normalizePromptCommand(rawCommand);
      if (!normalized) {
        return null;
      }
      return name ? { name, command: normalized } : null;
    }
    return name ? { name } : null;
  }

  const parts = args.split(/\s+/);
  const name = parts[0]?.trim();
  if (!name) {
    return null;
  }
  const rawCommand = parts[1] ?? undefined;
  if (rawCommand) {
    const normalized = normalizePromptCommand(rawCommand);
    if (!normalized) {
      return null;
    }
    return { name, command: normalized };
  }
  return { name };
}

function normalizeUserId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.startsWith("@") || !trimmed.includes(":")) {
    return null;
  }
  return trimmed;
}

async function handleSetGlobalPrompt(ctx: CommandContext, rawPrompt: string): Promise<void> {
  const parsed = parsePromptInput(rawPrompt);
  if (parsed === null) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: 'Usage: !admin setglobalprompt "PROMPT" (or !admin setglobalprompt clear)'
    });
    return;
  }

  await ctx.stateStore.save({ globalPrompt: parsed });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: parsed ? "Global prompt updated." : "Global prompt cleared."
  });
}

async function handleSetGlobalFactcheckPrompt(ctx: CommandContext, rawPrompt: string): Promise<void> {
  const parsed = parsePromptInput(rawPrompt);
  if (parsed === null) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: 'Usage: !admin setglobalfactcheckprompt "PROMPT" (or !admin setglobalfactcheckprompt clear)'
    });
    return;
  }

  await ctx.stateStore.save({ globalFactcheckPrompt: parsed });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: parsed ? "Global factcheck prompt updated." : "Global factcheck prompt cleared."
  });
}

function parsePromptInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.toLowerCase() === "clear") {
    return "";
  }
  if (trimmed.startsWith("\"")) {
    const match = trimmed.match(/^"([\s\S]+)"$/);
    if (!match) {
      return null;
    }
    const normalized = normalizePromptText(match[1]);
    return normalized ?? "";
  }
  const normalized = normalizePromptText(trimmed);
  return normalized ?? "";
}

async function handleSetQbitLabel(ctx: CommandContext, rawSelector: string): Promise<void> {
  const trimmed = rawSelector.trim();
  if (!trimmed) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: 'Usage: !admin setqbitlabel "{label=\\"value\\"}"'
    });
    return;
  }

  const normalized = normalizeLabelSelector(trimmed);
  if (!normalized) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: 'Usage: !admin setqbitlabel "{label=\\"value\\"}"'
    });
    return;
  }

  await ctx.stateStore.save({ qbittorrentLabelSelector: normalized });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: "Qbittorrent label selector updated."
  });
}

async function handleClearQbitLabel(ctx: CommandContext): Promise<void> {
  await ctx.stateStore.save({ qbittorrentLabelSelector: undefined });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: "Qbittorrent label selector reset to default."
  });
}

async function handleAddQbitLabel(ctx: CommandContext, rawPair: string): Promise<void> {
  const parsed = parseLabelPair(rawPair);
  if (!parsed) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Usage: !admin addqbitlabel key=value"
    });
    return;
  }

  const current = ctx.botConfig.qbittorrentLabelSelector ?? '{container="qbittorrent",job="qbittorrent"}';
  const labels = parseLabelSelector(current);
  if (!labels) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Current qbittorrent label selector is not a simple {key=\"value\"} list. Use !admin setqbitlabel instead."
    });
    return;
  }

  labels.set(parsed.key, parsed.value);
  const selector = `{${[...labels.entries()]
    .map(([key, value]) => `${key}="${value}"`)
    .join(",")}}`;

  await ctx.stateStore.save({ qbittorrentLabelSelector: selector });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: "Qbittorrent label selector updated."
  });
}

function parseLabelPair(value: string): { key: string; value: string } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.+)$/);
  if (!match) {
    return null;
  }
  const key = match[1];
  const rawValue = match[2].trim();
  if (!rawValue) {
    return null;
  }
  const valueUnquoted = rawValue.replace(/^"(.*)"$/, "$1");
  return valueUnquoted ? { key, value: valueUnquoted } : null;
}

function parseLabelSelector(selector: string): Map<string, string> | null {
  const trimmed = selector.trim();
  const match = trimmed.match(/^\{([\s\S]*)\}$/);
  if (!match) {
    return null;
  }
  const body = match[1].trim();
  if (!body) {
    return new Map();
  }
  const parts = body.split(",").map((part) => part.trim()).filter(Boolean);
  const labels = new Map<string, string>();
  for (const part of parts) {
    const kv = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)="(.*)"$/);
    if (!kv) {
      return null;
    }
    labels.set(kv[1], kv[2]);
  }
  return labels;
}

function recordMonitorHistory(state: BotState, id: string, name: string, rawArgs: string): void {
  const command = `!admin monitor ${rawArgs}`;
  const entry = {
    id,
    name,
    command,
    createdAt: new Date().toISOString()
  };
  state.monitorHistory = [...state.monitorHistory, entry].slice(-50);
}

function buildMonitorListKey(ctx: CommandContext): string {
  return `${ctx.roomId}:${ctx.sender}`;
}

function parseShowLimit(rawArgs: string): number | null {
  const normalized = rawArgs.trim();
  const parts = normalized.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  const last = parts[parts.length - 1];
  const value = Number.parseInt(last, 10);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

async function handleAddMonitor(ctx: CommandContext, rawArgs: string): Promise<void> {
  const parsed = parseTwoQuotedArgs(rawArgs);
  if (!parsed) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: 'Usage: !admin monitor "container" "sample log"'
    });
    return;
  }

  const { first: container, second: sample } = parsed;
  const safeContainer = container.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const selector = `{container="${safeContainer}"}`;
  const pattern = await derivePattern(ctx, sample);
  if (!pattern) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Unable to derive a monitor pattern from the sample log."
    });
    return;
  }

  const monitorName = container;
  const state = await ctx.stateStore.load();
  const existing = state.monitors.find((m) => m.name.toLowerCase() === monitorName.toLowerCase());
  if (existing) {
    existing.selector = selector;
    existing.pattern = pattern;
    state.monitorSeenKeys[existing.id] = [];
    recordMonitorHistory(state, existing.id, monitorName, rawArgs);
    await ctx.stateStore.save({
      monitors: state.monitors,
      monitorSeenKeys: state.monitorSeenKeys,
      monitorHistory: state.monitorHistory
    });
  } else {
    const id = randomId();
    state.monitors.push({
      id,
      name: monitorName,
      selector,
      pattern,
      createdAt: new Date().toISOString()
    });
    state.monitorSeenKeys[id] = [];
    recordMonitorHistory(state, id, monitorName, rawArgs);
    await ctx.stateStore.save({
      monitors: state.monitors,
      monitorSeenKeys: state.monitorSeenKeys,
      monitorHistory: state.monitorHistory
    });
  }

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `Monitor "${monitorName}" saved.\nPattern: ${pattern}`
  });
}

async function handleRemoveMonitor(ctx: CommandContext, rawName: string): Promise<void> {
  const value = rawName.trim();
  if (!value) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Usage: !admin unmonitor N | !admin unmonitor name"
    });
    return;
  }

  const index = Number.parseInt(value, 10);
  const state = await ctx.stateStore.load();

  if (Number.isInteger(index) && index > 0) {
    const listKey = buildMonitorListKey(ctx);
    const list = state.monitorLastList[listKey];
    if (!Array.isArray(list) || list.length === 0) {
      await ctx.client.sendMessage(ctx.roomId, {
        msgtype: "m.text",
        body: "No recent monitor list found. Run !admin showmonitoring first."
      });
      return;
    }
    if (index > list.length) {
      await ctx.client.sendMessage(ctx.roomId, {
        msgtype: "m.text",
        body: `Only ${list.length} item(s) in the last list.`
      });
      return;
    }
    const targetId = list[index - 1];
    const target = state.monitors.find((m) => m.id === targetId);
    if (!target) {
      await ctx.client.sendMessage(ctx.roomId, {
        msgtype: "m.text",
        body: "Selected monitor no longer exists."
      });
      return;
    }
    state.monitors = state.monitors.filter((m) => m.id !== target.id);
    delete state.monitorSeenKeys[target.id];
    await ctx.stateStore.save({
      monitors: state.monitors,
      monitorSeenKeys: state.monitorSeenKeys,
      monitorLastList: state.monitorLastList
    });
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Monitor "${target.name}" removed.`
    });
    return;
  }

  const target = state.monitors.find((m) => m.name.toLowerCase() === value.toLowerCase());
  if (!target) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `No monitor named "${value}" found.`
    });
    return;
  }
  state.monitors = state.monitors.filter((m) => m.id !== target.id);
  delete state.monitorSeenKeys[target.id];
  await ctx.stateStore.save({
    monitors: state.monitors,
    monitorSeenKeys: state.monitorSeenKeys,
    monitorLastList: state.monitorLastList
  });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `Monitor "${value}" removed.`
  });
}

async function handleListMonitors(ctx: CommandContext): Promise<void> {
  const state = await ctx.stateStore.load();
  if (state.monitors.length === 0) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "No monitors configured."
    });
    return;
  }

  const lines = ["Monitors:"];
  for (const monitor of state.monitors) {
    lines.push(`- ${monitor.name} (${monitor.selector} |~ "${monitor.pattern}")`);
  }
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });
}

async function handleShowMonitoring(ctx: CommandContext, rawArgs: string): Promise<void> {
  const state = await ctx.stateStore.load();
  const limit = parseShowLimit(rawArgs) ?? 10;
  const history = state.monitorHistory.slice(-limit).reverse();
  if (history.length === 0) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "No monitor history found."
    });
    return;
  }

  const lines = ["Recent monitor commands:"];
  const monitorIds: string[] = [];
  let index = 1;
  for (const entry of history) {
    lines.push(`${index}. ${entry.command}`);
    monitorIds.push(entry.id);
    index += 1;
  }

  const eventId = await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });

  state.monitorReviewTargets[eventId] = monitorIds;
  const listKey = buildMonitorListKey(ctx);
  state.monitorLastList[listKey] = monitorIds;
  await ctx.stateStore.save({
    monitorReviewTargets: state.monitorReviewTargets,
    monitorLastList: state.monitorLastList
  });
}

async function handleAddMonitorLabel(ctx: CommandContext, rawArgs: string): Promise<void> {
  const match = rawArgs.match(/^(\S+)\s+(.+)$/);
  if (!match) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Usage: !admin monitorlabel name key=value"
    });
    return;
  }

  const name = match[1].trim();
  const pair = parseLabelPair(match[2]);
  if (!pair) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Usage: !admin monitorlabel name key=value"
    });
    return;
  }

  const state = await ctx.stateStore.load();
  const monitor = state.monitors.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (!monitor) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `No monitor named "${name}" found.`
    });
    return;
  }

  const labels = parseLabelSelector(monitor.selector);
  if (!labels) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Monitor selector is not a simple {key=\"value\"} list."
    });
    return;
  }

  labels.set(pair.key, pair.value);
  monitor.selector = `{${[...labels.entries()].map(([key, value]) => `${key}="${value}"`).join(",")}}`;
  await ctx.stateStore.save({ monitors: state.monitors });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `Monitor "${monitor.name}" selector updated.`
  });
}

async function derivePattern(ctx: CommandContext, sample: string): Promise<string | null> {
  if (ctx.llmStudio && ctx.isAllowedUser) {
    try {
      const systemPrompt =
        "You are a sysadmin and network monitoring specialist. You have been given a log that has significance and you need to monitor for similar logs. Create a regex to search for similar logs ignoring things like dates, ports and ids and focusing on the keywords in this log";
      const userPrompt = [
        "Return ONLY the regex pattern. No prose, no JSON, no markdown.",
        "The pattern should be a safe regex fragment for Loki's |~ operator, without slashes.",
        "Keep it short (<= 120 chars) and target the meaningful part of the message.",
        `Log line: ${sample}`
      ].join("\n");
      const reply = await ctx.llmStudio.chat(userPrompt, systemPrompt);
      const parsed = extractPattern(reply);
      if (parsed) {
        return parsed;
      }
    } catch {
      // fall back to heuristic
    }
  }

  return heuristicPattern(sample);
}

function extractPattern(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (!trimmed.startsWith("{") && !trimmed.includes("\n")) {
    return trimPattern(trimmed);
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(match[0]) as { pattern?: string };
    if (typeof parsed.pattern !== "string") {
      return null;
    }
    return trimPattern(parsed.pattern);
  } catch {
    return null;
  }
}

function trimPattern(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 120) {
    return trimmed.slice(0, 120);
  }
  return trimmed;
}

function heuristicPattern(sample: string): string | null {
  const trimmed = sample.trim();
  if (!trimmed) {
    return null;
  }

  if (/file error alert/i.test(trimmed)) {
    return escapeRegex("File error alert");
  }
  if (/added new torrent/i.test(trimmed)) {
    return escapeRegex("Added new torrent");
  }
  if (/torrent download finished/i.test(trimmed)) {
    return escapeRegex("Torrent download finished");
  }

  let text = trimmed;
  const sepIndex = text.indexOf(" - ");
  if (sepIndex >= 0) {
    text = text.slice(sepIndex + 3).trim();
  }
  const words = text.split(/\s+/).filter(Boolean);
  const phrase = words.slice(0, 6).join(" ");
  if (!phrase) {
    return null;
  }
  const escaped = escapeRegex(phrase);
  return escaped.length > 120 ? escaped.slice(0, 120) : escaped;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\\\$&");
}

function parseTwoQuotedArgs(args: string): { first: string; second: string } | null {
  const match = args.match(/^"([\s\S]+)"\s+"([\s\S]+)"$/);
  if (!match) {
    return null;
  }
  return { first: match[1].trim(), second: match[2].trim() };
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

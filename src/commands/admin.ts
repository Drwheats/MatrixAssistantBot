import { CommandContext } from "../types/commandContext";
import { env } from "../config/env";
import { normalizeLabelSelector, normalizePromptCommand, normalizePromptText } from "../services/botConfig";
import { startLlmReactions } from "../utils/llmReactions";
import {
  readActiveSshConnections,
  readBatteryPercent,
  readCpuUsagePercent,
  readDiskUsage,
  readMemoryUsage,
  readThermalStatus
} from "../utils/sysinfo";
import { geocodeLocation, getWeatherLocation } from "../services/weatherLocation";
import { saveMonitorFromSample } from "../services/monitorRegistry";

const ADMIN_PREFIX = "!admin";

export async function handleAdminCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAdminUser) {
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

  if (args.toLowerCase().startsWith("allowseerr ")) {
    await handleAllowSeerrUser(ctx, args.slice("allowseerr ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("denyseerr ")) {
    await handleDenySeerrUser(ctx, args.slice("denyseerr ".length).trim());
    return;
  }

  if (args.toLowerCase() === "users") {
    await handleListUsers(ctx);
    return;
  }

  if (args.toLowerCase().startsWith("open ")) {
    await handleOpenMode(ctx, args.slice("open ".length).trim());
    return;
  }

  if (args.toLowerCase() === "listprompts") {
    await handleListPrompts(ctx);
    return;
  }

  if (args.toLowerCase().startsWith("changemodel ")) {
    await handleChangeModel(ctx, args.slice("changemodel ".length).trim());
    return;
  }

  if (args.toLowerCase() === "promptinfo") {
    await handlePromptInfo(ctx);
    return;
  }

  if (args.toLowerCase() === "sysinfo") {
    await handleSysinfo(ctx);
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

  if (args.toLowerCase().startsWith("setmonitorprompt ")) {
    await handleSetMonitorPrompt(ctx, args.slice("setmonitorprompt ".length).trim());
    return;
  }

  if (args.toLowerCase().startsWith("location")) {
    await handleLocation(ctx, args.slice("location".length).trim());
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

  if (args.toLowerCase().startsWith("testing")) {
    await handleTestingMode(ctx, args.slice("testing".length).trim());
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

async function handleAllowSeerrUser(ctx: CommandContext, rawUser: string): Promise<void> {
  const userId = normalizeUserId(rawUser);
  if (!userId) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Usage: !admin allowseerr @user:server"
    });
    return;
  }

  const current = Array.isArray(ctx.botConfig.seerrAllowedUsers) ? ctx.botConfig.seerrAllowedUsers : [];
  if (current.includes(userId)) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `${userId} is already allowed to request movies.`
    });
    return;
  }

  const updated = [...current, userId];
  await ctx.stateStore.save({ seerrAllowedUsers: updated });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `${userId} can now request movies.`
  });
}

async function handleDenySeerrUser(ctx: CommandContext, rawUser: string): Promise<void> {
  const userId = normalizeUserId(rawUser);
  if (!userId) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Usage: !admin denyseerr @user:server"
    });
    return;
  }

  const current = Array.isArray(ctx.botConfig.seerrAllowedUsers) ? ctx.botConfig.seerrAllowedUsers : [];
  if (!current.includes(userId)) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `${userId} is not in the Seerr allowed list.`
    });
    return;
  }

  const updated = current.filter((id) => id !== userId);
  await ctx.stateStore.save({ seerrAllowedUsers: updated });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `${userId} can no longer request movies.`
  });
}

async function handleListUsers(ctx: CommandContext): Promise<void> {
  const adminUsers = env.allowedUsers;
  const promptUsers = ctx.botConfig.extraAllowedUsers;
  const seerrUsers = ctx.botConfig.seerrAllowedUsers;

  const all = new Set<string>();
  for (const user of adminUsers) {
    all.add(user);
  }
  for (const user of promptUsers) {
    all.add(user);
  }
  for (const user of seerrUsers) {
    all.add(user);
  }

  const rows = Array.from(all)
    .sort((a, b) => a.localeCompare(b))
    .map((user) => ({
      user,
      admin: adminUsers.includes(user) ? "Yes" : "No",
      prompts: ctx.botConfig.openMode
        ? "Open"
        : adminUsers.includes(user) || promptUsers.includes(user)
          ? "Yes"
          : "No",
      seerr: adminUsers.includes(user) || seerrUsers.includes(user) ? "Yes" : "No"
    }));

  const lines = [
    "User permissions:",
    formatUserTable(rows),
    ctx.botConfig.openMode
      ? "Note: Open mode is ON, so anyone can use prompt commands regardless of the list above."
      : ""
  ].filter((line) => line.length > 0);

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
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
  const seerrUsers = ctx.botConfig.seerrAllowedUsers.length > 0 ? ctx.botConfig.seerrAllowedUsers.join(", ") : "(none)";
  const globalPrompt = ctx.botConfig.globalPrompt ? "set" : "(unset)";
  const globalFactcheckPrompt = ctx.botConfig.globalFactcheckPrompt ? "set" : "(unset)";
  const monitorPrompt = ctx.botConfig.monitorPrompt ? "set" : "(unset)";
  const qbitLabel = ctx.botConfig.qbittorrentLabelSelector ?? "(default)";
  const lines = [
    `Bot display name: ${ctx.botConfig.botDisplayName ?? "(unchanged)"}`,
    `Prompt command: ${ctx.botConfig.promptCommand}`,
    `Open mode: ${ctx.botConfig.openMode ? "ON" : "OFF"}`,
    `Testing mode: ${ctx.botConfig.testingMode ? "ON" : "OFF"}`,
    `Admin users (.env): ${allowedUsers}`,
    `Extra allowed users: ${extraUsers}`,
    `Seerr allowed users: ${seerrUsers}`,
    `Location: ${ctx.botConfig.weatherLocation.name} (${ctx.botConfig.weatherLocation.timezone})`,
    `Global prompt: ${globalPrompt}`,
    `Global factcheck prompt: ${globalFactcheckPrompt}`,
    `Monitor prompt: ${monitorPrompt}`,
    `Qbittorrent label selector: ${qbitLabel}`
  ];

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });
}

async function handleListPrompts(ctx: CommandContext): Promise<void> {
  const lines = [
    "Prompts:",
    `Global prompt: ${formatPrompt(ctx.botConfig.globalPrompt)}`,
    `Global factcheck prompt: ${formatPrompt(ctx.botConfig.globalFactcheckPrompt)}`,
    `Monitor prompt: ${formatPrompt(ctx.botConfig.monitorPrompt)}`
  ];

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });
}

async function handlePromptInfo(ctx: CommandContext): Promise<void> {
  const promptCommand = ctx.botConfig.promptCommand;
  const lines = [
    "Prompt info:",
    `LLM command: ${promptCommand} YOUR_QUESTION`,
    `LLM model: ${ctx.botConfig.llmModel ?? "(unset)"}`,
    `System prompt: ${formatPrompt(ctx.botConfig.globalPrompt)}`,
    `Factcheck system prompt: ${formatPrompt(ctx.botConfig.globalFactcheckPrompt ?? "You are a fact checker.")}`
  ];

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });
}

async function handleChangeModel(ctx: CommandContext, rawModel: string): Promise<void> {
  const model = rawModel.trim();
  if (!model) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Usage: !admin changemodel MODEL_NAME"
    });
    return;
  }

  await ctx.userConfigStore.save({ llmModel: model });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `LLM model updated to ${model}.`
  });
}

function formatPrompt(prompt?: string): string {
  if (!prompt) {
    return "(unset)";
  }
  return prompt;
}

async function handleSysinfo(ctx: CommandContext): Promise<void> {
  const lines: string[] = ["System info:"];

  if (process.platform !== "darwin" && process.platform !== "linux") {
    lines.push(`Platform: ${process.platform} (sysinfo supported on macOS and Linux only).`);
  } else {
    const battery = await readBatteryPercent();
    lines.push(`Battery: ${battery !== null ? `${battery}%` : "unknown"}`);

    const cpuUsage = await readCpuUsagePercent();
    lines.push(`CPU usage: ${cpuUsage !== null ? `${cpuUsage.toFixed(1)}%` : "unknown"}`);

    const mem = await readMemoryUsage();
    if (mem) {
      const percent = Math.round((mem.usedBytes / mem.totalBytes) * 100);
      lines.push(`Memory: ${formatBytes(mem.usedBytes)} / ${formatBytes(mem.totalBytes)} (${percent}%)`);
    } else {
      lines.push("Memory: unknown");
    }

    const disk = await readDiskUsage("/");
    if (disk) {
      lines.push(`Disk (/): ${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)} (${disk.usedPercent}%)`);
    } else {
      lines.push("Disk (/): unknown");
    }

    const thermal = await readThermalStatus();
    if (thermal) {
      const status = thermal.isAnomalous ? `ANOMALY - ${thermal.message}` : thermal.message;
      lines.push(`Thermal: ${status}`);
    } else {
      lines.push("Thermal: unknown");
    }

    const ssh = await readActiveSshConnections();
    if (ssh) {
      lines.push(`Active SSH connections: ${ssh.length}`);
      if (ssh.length > 0) {
        for (const entry of ssh) {
          lines.push(`- ${entry}`);
        }
      }
    } else {
      lines.push("Active SSH connections: unknown");
    }
  }

  await ctx.alertsChannel.sendMessage(lines.join("\n"));
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: "Sysinfo sent to alerts channel."
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatUserTable(
  rows: Array<{ user: string; admin: string; prompts: string; seerr: string }>
): string {
  if (rows.length === 0) {
    return "No users configured.";
  }

  const header = ["User", "Admin", "Prompts", "Seerr"];
  const widths = [
    Math.max(header[0].length, ...rows.map((row) => row.user.length)),
    Math.max(header[1].length, ...rows.map((row) => row.admin.length)),
    Math.max(header[2].length, ...rows.map((row) => row.prompts.length)),
    Math.max(header[3].length, ...rows.map((row) => row.seerr.length))
  ];

  const pad = (value: string, width: number) => value.padEnd(width, " ");
  const formatRow = (values: string[]) => values.map((value, idx) => pad(value, widths[idx])).join(" | ");

  const lines = [
    formatRow(header),
    widths.map((width) => "-".repeat(width)).join("-|-"),
    ...rows.map((row) => formatRow([row.user, row.admin, row.prompts, row.seerr]))
  ];

  return lines.join("\n");
}

async function sendAdminHelp(ctx: CommandContext): Promise<void> {
  const lines = [
    "Admin commands:",
    '!admin rename "NAME" [!command] - rename the bot and optionally the prompt command',
    "!admin command !name - set the prompt command",
    "!admin allow @user:server - allow a new user",
    "!admin deny @user:server - revoke a user",
    "!admin allowseerr @user:server - allow a user to request movies",
    "!admin denyseerr @user:server - revoke Seerr access",
    "!admin users - list users and permissions",
    "!admin open on|off|status - toggle open mode",
    "!admin testing [on|off|status] - toggle quiet testing mode",
    "!admin listprompts - list all prompts",
    "!admin changemodel MODEL_NAME - set LLM model for API requests",
    "!admin promptinfo - show LLM command and system prompts",
    "!admin sysinfo - send system info to alerts channel",
    "!admin location NAME - set weather/timezone location (example: !admin location istanbul)",
    '!admin setglobalprompt "PROMPT" - set default LLM prompt (use "clear" to reset)',
    '!admin setglobalfactcheckprompt "PROMPT" - set factcheck prompt (use "clear" to reset)',
    '!admin setmonitorprompt "PROMPT" - append extra monitor regex instructions (use "clear" to reset)',
    '!admin setqbitlabel "{label=\\"value\\"}" - set qbittorrent label selector',
    "!admin addqbitlabel key=value - add/overwrite a qbittorrent label selector pair",
    "!admin clearqbitlabel - reset qbittorrent label selector",
    '!admin monitor "sample log" - add a Grafana log monitor for any matching log',
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

async function handleTestingMode(ctx: CommandContext, arg: string): Promise<void> {
  const normalized = arg.trim().toLowerCase();
  if (!normalized || normalized === "on") {
    await ctx.userConfigStore.save({ testingMode: true });
    console.log("Testing mode enabled (bot messages suppressed).");
    return;
  }

  if (normalized === "off") {
    await ctx.userConfigStore.save({ testingMode: false });
    console.log("Testing mode disabled (bot messages active).");
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Testing mode is now OFF."
    });
    return;
  }

  if (normalized === "status") {
    console.log(`Testing mode status requested: ${ctx.botConfig.testingMode ? "ON" : "OFF"}.`);
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Testing mode is ${ctx.botConfig.testingMode ? "ON" : "OFF"}.`
    });
    return;
  }

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: "Usage: !admin testing [on|off|status]"
  });
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

  await ctx.userConfigStore.save({ globalPrompt: parsed });
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

  await ctx.userConfigStore.save({ globalFactcheckPrompt: parsed });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: parsed ? "Global factcheck prompt updated." : "Global factcheck prompt cleared."
  });
}

async function handleSetMonitorPrompt(ctx: CommandContext, rawPrompt: string): Promise<void> {
  const parsed = parsePromptInput(rawPrompt);
  if (parsed === null) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: 'Usage: !admin setmonitorprompt "PROMPT" (or !admin setmonitorprompt clear)'
    });
    return;
  }

  await ctx.userConfigStore.save({ monitorPrompt: parsed });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: parsed
      ? "Monitor prompt updated. It will be appended to the built-in regex instructions."
      : "Monitor prompt cleared."
  });
}

async function handleLocation(ctx: CommandContext, rawLocation: string): Promise<void> {
  const trimmed = rawLocation.trim();
  if (!trimmed || trimmed.toLowerCase() === "status") {
    const location = ctx.botConfig.weatherLocation ?? getWeatherLocation();
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Current location: ${location.name} (${location.timezone})`
    });
    return;
  }

  try {
    const location = await geocodeLocation(trimmed);
    if (!location) {
      await ctx.client.sendMessage(ctx.roomId, {
        msgtype: "m.text",
        body: `Could not find a location for "${trimmed}".`
      });
      return;
    }

    await ctx.stateStore.save({
      weatherLocationName: location.name,
      weatherLocationLat: location.latitude,
      weatherLocationLon: location.longitude,
      weatherLocationTimezone: location.timezone
    });

    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Location updated to ${location.name} (${location.timezone}).`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Location update failed: ${message}`
    });
  }
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
  const parsed = parseMonitorArgs(rawArgs);
  if (!parsed) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: 'Usage: !admin monitor "sample log"'
    });
    return;
  }

  const { name, sample } = parsed;
  const reactionTargetId = ctx.eventId ?? null;
  const reactions = reactionTargetId ? startLlmReactions(ctx, reactionTargetId) : null;
  const result = await derivePattern(ctx, sample, {
    rawCommand: `!admin monitor ${rawArgs}`,
    preferredName: name
  });
  if (reactions) {
    await reactions.finish();
  }
  if (!result) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Unable to derive a valid regex monitor pattern from the sample log."
    });
    return;
  }

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `Monitor "${result.name}" saved.\nSelector: {}\nPattern: ${result.pattern}`
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
  const userConfig = await ctx.userConfigStore.load();

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
    const target = userConfig.monitors.find((m) => m.id === targetId);
    if (!target) {
      await ctx.client.sendMessage(ctx.roomId, {
        msgtype: "m.text",
        body: "Selected monitor no longer exists."
      });
      return;
    }
    delete state.monitorSeenKeys[target.id];
    await ctx.userConfigStore.save({
      monitors: userConfig.monitors.filter((m) => m.id !== target.id)
    });
    await ctx.stateStore.save({ monitorSeenKeys: state.monitorSeenKeys, monitorLastList: state.monitorLastList });
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Monitor "${target.name}" removed.`
    });
    return;
  }

  const target = userConfig.monitors.find((m) => m.name.toLowerCase() === value.toLowerCase());
  if (!target) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `No monitor named "${value}" found.`
    });
    return;
  }
  delete state.monitorSeenKeys[target.id];
  await ctx.userConfigStore.save({
    monitors: userConfig.monitors.filter((m) => m.id !== target.id)
  });
  await ctx.stateStore.save({ monitorSeenKeys: state.monitorSeenKeys, monitorLastList: state.monitorLastList });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `Monitor "${value}" removed.`
  });
}

async function handleListMonitors(ctx: CommandContext): Promise<void> {
  const userConfig = await ctx.userConfigStore.load();
  if (userConfig.monitors.length === 0) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "No monitors configured."
    });
    return;
  }

  const lines = ["Monitors:"];
  for (const monitor of userConfig.monitors) {
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

  const userConfig = await ctx.userConfigStore.load();
  const monitor = userConfig.monitors.find((m) => m.name.toLowerCase() === name.toLowerCase());
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
  await ctx.userConfigStore.save({ monitors: userConfig.monitors });
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: `Monitor "${monitor.name}" selector updated.`
  });
}

async function derivePattern(
  ctx: CommandContext,
  sample: string,
  options: { rawCommand: string; preferredName?: string }
): Promise<{ name: string; pattern: string } | null> {
  try {
    const result = await saveMonitorFromSample(ctx, sample, options);
    if (result) {
      return result;
    }
    console.warn("LLM monitor pattern rejected.", { sample });
  } catch (error) {
    console.warn("LLM monitor pattern generation failed.", error);
  }
  return null;
}

function parseMonitorArgs(args: string): { name?: string; sample: string } | null {
  const single = args.match(/^"([\s\S]+)"$/);
  if (single) {
    return { sample: single[1].trim() };
  }

  const double = args.match(/^"([\s\S]+)"\s+"([\s\S]+)"$/);
  if (double) {
    return { name: double[1].trim(), sample: double[2].trim() };
  }

  return null;
}

import { CommandContext } from "../types/commandContext";
import { env } from "../config/env";
import { normalizePromptCommand } from "../services/botConfig";

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
  const lines = [
    `Bot display name: ${ctx.botConfig.botDisplayName ?? "(unchanged)"}`,
    `Prompt command: ${ctx.botConfig.promptCommand}`,
    `Open mode: ${ctx.botConfig.openMode ? "ON" : "OFF"}`,
    `Admin users (.env): ${allowedUsers}`,
    `Extra allowed users: ${extraUsers}`
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

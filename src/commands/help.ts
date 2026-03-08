import { CommandContext } from "../types/commandContext";

export async function handleHelpCommand(ctx: CommandContext): Promise<void> {
  const lines = [
    "Available commands:",
    "!ping - health check",
    "!help - show this help",
    "!calendar today - list next 3 events today (Google Calendar)",
    "!trello due - list due cards in the next 24h (Trello)"
  ];

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });
}

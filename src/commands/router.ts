import { handleCalendarTodayCommand } from "./calendar";
import { handleHelpCommand } from "./help";
import { handlePingCommand } from "./ping";
import { handleTrelloDueCommand } from "./trello";
import { CommandContext } from "../types/commandContext";

export async function routeCommand(ctx: CommandContext): Promise<void> {
  const normalized = ctx.commandBody.trim().toLowerCase();

  if (normalized === "!ping") {
    await handlePingCommand(ctx);
    return;
  }

  if (normalized === "!help") {
    await handleHelpCommand(ctx);
    return;
  }

  if (normalized === "!calendar today") {
    await handleCalendarTodayCommand(ctx);
    return;
  }

  if (normalized === "!trello due") {
    await handleTrelloDueCommand(ctx);
    return;
  }

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: "Unknown command. Use !help"
  });
}

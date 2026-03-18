import { handleCalendarTodayCommand } from "./calendar";
import { handleGrafanaCommand } from "./grafana";
import { handleHelpCommand } from "./help";
import { handlePingCommand } from "./ping";
import { handleTrelloCreateCommand, handleTrelloDueCommand, handleTrelloOverdueCommand } from "./trello";
import { handleBlimpfCommand, handleFactcheckCommand } from "./llmStudio";
import { handleAdminCommand } from "./admin";
import { handleGithubCommand } from "./github";
import { CommandContext } from "../types/commandContext";

export async function routeCommand(ctx: CommandContext): Promise<void> {
  const normalized = ctx.commandBody.trim().toLowerCase();
  const promptCommand = ctx.botConfig.promptCommand.toLowerCase();

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

  if (normalized === "!trello overdue") {
    await handleTrelloOverdueCommand(ctx);
    return;
  }

  if (normalized.startsWith("!trello create ")) {
    await handleTrelloCreateCommand(ctx);
    return;
  }

  if (normalized === "!grafana" || normalized.startsWith("!grafana ")) {
    await handleGrafanaCommand(ctx);
    return;
  }

  if (normalized === "!github" || normalized.startsWith("!github ")) {
    await handleGithubCommand(ctx);
    return;
  }

  if (normalized === promptCommand || normalized.startsWith(`${promptCommand} `)) {
    await handleBlimpfCommand(ctx);
    return;
  }

  if (normalized === "!factcheck") {
    await handleFactcheckCommand(ctx);
    return;
  }

  if (normalized === "!admin" || normalized.startsWith("!admin ")) {
    await handleAdminCommand(ctx);
    return;
  }

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: "Unknown command. Use !help"
  });
}

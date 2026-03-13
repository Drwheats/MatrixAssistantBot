import { CommandContext } from "../types/commandContext";

export async function handleHelpCommand(ctx: CommandContext): Promise<void> {
  const promptCommand = ctx.botConfig.promptCommand;
  const lines = [
    "Available commands:",
    "!ping - health check",
    "!help - show this help",
    "!calendar today - list next 3 events today (Google Calendar)",
    "!trello due - list due cards in the next 24h (Trello)",
    '!trello create "TASK" DATE - create Trello card (examples: mar 10, march tenth, tomorrow, end of week, next friday, in 3 days, in 2 hours, 2 hours from now, the 15th, 15)',
    "!trello overdue - list overdue Trello cards",
    "!grafana help - show Grafana command usage",
    "!grafana critical [window] - list critical logs",
    "!grafana errors [service] [window] - list error logs",
    "!grafana alerts [state] - list alerts by state",
    "!grafana incident [window] - incident summary",
    '!grafana service "NAME" [window] - service health snapshot',
    "!grafana spikes [window] - compare current/previous error rates",
    '!grafana query "LOKI_QUERY" [window] - run a raw Loki query',
    `${promptCommand} PROMPT - send a prompt to LLM Studio`,
    `${promptCommand} weather - weather today (current location)`,
    `${promptCommand} rundown - Trello counts, due today, and weather`,
    "!factcheck - reply to a message with this to fact check it"
  ];

  if (ctx.isAdminUser) {
    lines.push(
      "",
      "Admin commands:",
      '!admin rename "NAME" [!command] - rename the bot and optionally the prompt command',
      "!admin command !name - set the prompt command",
      "!admin allow @user:server - allow a new user",
      "!admin deny @user:server - revoke a user",
      "!admin open on|off|status - toggle open mode",
      "!admin listprompts - list all prompts",
      "!admin sysinfo - send system info to alerts channel",
      '!admin monitor "container" "sample log" - add a Grafana log monitor',
      "!admin monitorlabel name key=value - add/overwrite monitor label selector",
      "!admin showmonitoring [N] - list recent monitor commands",
      "!admin unmonitor N - remove monitor by number from last list",
      '!admin setmonitorprompt "PROMPT" - set monitor prompt',
      "!admin status - show current settings"
    );
  }

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });
}

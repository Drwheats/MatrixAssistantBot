import { CommandContext } from "../types/commandContext";

export async function handleHelpCommand(ctx: CommandContext): Promise<void> {
  const lines = [
    "Available commands:",
    "!ping - health check",
    "!help - show this help",
    "!calendar today - list next 3 events today (Google Calendar)",
    "!trello due - list due cards in the next 24h (Trello)",
    '!trello create "TASK" DATE - create Trello card (examples: mar 10, march tenth, tomorrow, end of week, next friday, in 3 days, the 15th, 15)',
    "!trello overdue - list overdue Trello cards",
    "!grafana help - show Grafana command usage",
    "!grafana critical [window] - list critical logs",
    "!grafana errors [service] [window] - list error logs",
    "!grafana alerts [state] - list alerts by state",
    "!grafana incident [window] - incident summary",
    '!grafana service "NAME" [window] - service health snapshot',
    "!grafana spikes [window] - compare current/previous error rates",
    '!grafana query "LOKI_QUERY" [window] - run a raw Loki query'
  ];

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });
}

import { CommandContext } from "../types/commandContext";

export async function handleHelpCommand(ctx: CommandContext): Promise<void> {
  const promptCommand = ctx.botConfig.promptCommand;
  const lines = [
    "Top commands:",
    `${promptCommand} YOUR_QUESTION - ask the assistant`,
    `${promptCommand} monitor "LOG LINE" - save a regex monitor for matching logs`,
    `${promptCommand} download MOVIE - request a Jellyfin movie (Seerr)`,
    "!github summary | !github updates | !github issues | !github prs | !github ci",
    '!trello due | !trello overdue | !trello create "TASK" DATE - Trello',
    "!factcheck - reply to a message to fact check it",
    `${promptCommand} weather | ${promptCommand} rundown | !admin sysinfo - weather, updates, device status`,
    "!admin lastlogs - show the 5 latest Grafana logs visible to the bot",
    "!admin grafanatest - diagnose Grafana/Loki integration end-to-end",
    "",
    "Full command list:",
    "`https://github.com/Drwheats/MatrixAssistantBot/blob/main/README.md"
  ];

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });
}

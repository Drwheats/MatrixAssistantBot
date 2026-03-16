import { CommandContext } from "../types/commandContext";

export async function handleHelpCommand(ctx: CommandContext): Promise<void> {
  const promptCommand = ctx.botConfig.promptCommand;
  const lines = [
    "Top commands:",
    `${promptCommand} YOUR_QUESTION - ask the assistant`,
    `${promptCommand} download MOVIE - request a Jellyfin movie (Seerr)`,
    '!trello due | !trello overdue | !trello create "TASK" DATE - Trello',
    "!factcheck - reply to a message to fact check it",
    `${promptCommand} weather | ${promptCommand} rundown | !admin sysinfo - weather, updates, device status`,
    "",
    "Full command list:",
    "`https://github.com/Drwheats/MatrixAssistantBot/blob/main/README.md`"
  ];

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: lines.join("\n")
  });
}

import { CommandContext } from "../types/commandContext";

export async function handlePingCommand(ctx: CommandContext): Promise<void> {
  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: "pong"
  });
}

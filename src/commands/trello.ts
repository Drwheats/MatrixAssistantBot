import { CommandContext } from "../types/commandContext";

export async function handleTrelloDueCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAllowedUser) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "You are not allowed to use integration commands."
    });
    return;
  }

  try {
    const cards = await ctx.trello.getDueWithin24h(5);

    const body =
      cards.length === 0
        ? "No Trello cards due in the next 24h."
        : [
            "Trello cards due in next 24h:",
            ...cards.map((c) => `- ${c.due}: ${c.name}${c.url ? ` (${c.url})` : ""}`)
          ].join("\n");

    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Trello error: ${message}`
    });
  }
}

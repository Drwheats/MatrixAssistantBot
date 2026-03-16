import { CommandContext } from "../types/commandContext";
import { sendErrorReply } from "../utils/errorReactions";

export async function handleCalendarTodayCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAdminUser) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "You are not allowed to use calendar commands."
    });
    return;
  }

  try {
    const events = await ctx.googleCalendar.getTodayEvents(3);

    const body =
      events.length === 0
        ? "No events found for today."
        : [
            "Today's next events:",
            ...events.map((e) => `- ${e.start}: ${e.summary}`)
          ].join("\n");

    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await sendErrorReply(ctx, ctx.eventId, `Calendar error: ${message}`);
  }
}

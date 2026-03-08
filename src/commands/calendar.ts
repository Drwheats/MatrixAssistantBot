import { CommandContext } from "../types/commandContext";

export async function handleCalendarTodayCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAllowedUser) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "You are not allowed to use integration commands."
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
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Calendar error: ${message}`
    });
  }
}

import { CommandContext } from "../types/commandContext";

const FACTCHECK_SYSTEM_PROMPT = "You are a fact checker. Check this post.";

export async function handleBlimpfCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAllowedUser) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "You are not allowed to use integration commands."
    });
    return;
  }

  const prompt = extractPrompt(ctx.commandBody, "!blimpf");
  if (!prompt) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Usage: !blimpf PROMPT"
    });
    return;
  }

  try {
    const reply = await ctx.llmStudio.chat(prompt);
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: reply
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `LLM Studio error: ${message}`
    });
  }
}

export async function handleFactcheckCommand(ctx: CommandContext): Promise<void> {
  if (!ctx.isAllowedUser) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "You are not allowed to use integration commands."
    });
    return;
  }

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body: "Usage: reply to a message with !factcheck to check the original post."
  });
}

export async function handleFactcheckReplyMessage(
  ctx: CommandContext,
  event: Record<string, any>
): Promise<boolean> {
  if (!ctx.isAllowedUser) {
    return false;
  }

  const body = String(event?.content?.body ?? "").trim();
  if (body.toLowerCase() !== "!factcheck") {
    return false;
  }

  const replyToEventId = getReplyToEventId(event);
  if (!replyToEventId) {
    return false;
  }

  let repliedEvent: Record<string, any> | null = null;
  try {
    repliedEvent = await ctx.client.getEvent(ctx.roomId, replyToEventId);
  } catch (error) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "Could not load the replied-to message for fact checking."
    });
    return true;
  }

  const repliedBody = String(repliedEvent?.content?.body ?? "").trim();
  if (!repliedBody) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "The replied-to message has no text to fact check."
    });
    return true;
  }

  try {
    const reply = await ctx.llmStudio.chat(repliedBody, FACTCHECK_SYSTEM_PROMPT);
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: reply
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `LLM Studio error: ${message}`
    });
  }

  return true;
}

function extractPrompt(commandBody: string, command: string): string | null {
  const match = commandBody.match(new RegExp(`^${command}\\s+([\\s\\S]+)$`, "i"));
  if (!match) {
    return null;
  }
  const prompt = match[1].trim();
  return prompt.length > 0 ? prompt : null;
}

function getReplyToEventId(event: Record<string, any>): string | null {
  const relatesTo = event?.content?.["m.relates_to"];
  const inReplyTo = relatesTo?.["m.in_reply_to"];
  const eventId = inReplyTo?.event_id;
  return typeof eventId === "string" ? eventId : null;
}

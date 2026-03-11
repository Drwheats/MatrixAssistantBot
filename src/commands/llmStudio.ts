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

  const promptCommand = ctx.botConfig.promptCommand;
  const prompt = extractPrompt(ctx.commandBody, promptCommand);
  if (!prompt) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Usage: ${promptCommand} PROMPT`
    });
    return;
  }

  const reactionTargetId = ctx.eventId ?? null;
  const reactions = reactionTargetId ? startBlimpfReactions(ctx, reactionTargetId) : null;

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
  } finally {
    if (reactions) {
      await reactions.finish();
    }
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
  const escaped = escapeRegExp(command);
  const match = commandBody.match(new RegExp(`^${escaped}\\s+([\\s\\S]+)$`, "i"));
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

function startBlimpfReactions(ctx: CommandContext, eventId: string) {
  let eyeReactionId: string | null = null;
  let thinkingReactionId: string | null = null;

  const swapPromise = (async () => {
    try {
      eyeReactionId = await sendReaction(ctx, eventId, "👀");
      await sleep(1000);
      if (eyeReactionId) {
        await redactReaction(ctx, eyeReactionId);
        eyeReactionId = null;
      }
      thinkingReactionId = await sendReaction(ctx, eventId, "🤔💭");
    } catch (error) {
      console.warn(`Failed to manage ${ctx.botConfig.promptCommand} reactions:`, error);
    }
  })();

  return {
    async finish(): Promise<void> {
      await swapPromise;
      if (thinkingReactionId) {
        await redactReaction(ctx, thinkingReactionId);
        thinkingReactionId = null;
      }
    }
  };
}

async function sendReaction(ctx: CommandContext, eventId: string, key: string): Promise<string | null> {
  try {
    const reactionEventId = await ctx.client.sendEvent(ctx.roomId, "m.reaction", {
      "m.relates_to": {
        rel_type: "m.annotation",
        event_id: eventId,
        key
      }
    });
    return reactionEventId;
  } catch (error) {
    console.warn(`Failed to send reaction ${key}:`, error);
    return null;
  }
}

async function redactReaction(ctx: CommandContext, reactionEventId: string): Promise<void> {
  try {
    await ctx.client.redactEvent(ctx.roomId, reactionEventId);
  } catch (error) {
    console.warn("Failed to remove reaction:", error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

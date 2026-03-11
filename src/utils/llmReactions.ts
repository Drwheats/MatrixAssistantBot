import { CommandContext } from "../types/commandContext";

export function startLlmReactions(ctx: CommandContext, eventId: string) {
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
      console.warn("Failed to manage LLM reactions:", error);
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

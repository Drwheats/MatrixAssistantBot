import { CommandContext } from "../types/commandContext";

const ERROR_REACTION_LIMIT = 500;

export async function sendErrorReply(
  ctx: CommandContext,
  eventId: string | undefined,
  body: string
): Promise<void> {
  const sentId = await sendReplyWithEventId(ctx, eventId, body);
  if (!sentId) {
    return;
  }

  await rememberErrorReaction(ctx, sentId, body);
  await sendReaction(ctx, sentId, "❓");
}

async function sendReplyWithEventId(
  ctx: CommandContext,
  eventId: string | undefined,
  body: string
): Promise<string | undefined> {
  if (!eventId) {
    return ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body
    });
  }

  return ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body,
    "m.relates_to": {
      "m.in_reply_to": {
        event_id: eventId
      }
    }
  });
}

async function rememberErrorReaction(ctx: CommandContext, eventId: string, message: string): Promise<void> {
  const state = await ctx.stateStore.load();
  const targets = { ...(state.errorReactionTargets ?? {}) };
  targets[eventId] = message;

  const keys = Object.keys(targets);
  if (keys.length > ERROR_REACTION_LIMIT) {
    const excess = keys.length - ERROR_REACTION_LIMIT;
    const sorted = keys.sort();
    for (let i = 0; i < excess; i += 1) {
      delete targets[sorted[i]];
    }
  }

  await ctx.stateStore.save({ errorReactionTargets: targets });
}

async function sendReaction(ctx: CommandContext, eventId: string, key: string): Promise<void> {
  try {
    await ctx.client.sendEvent(ctx.roomId, "m.reaction", {
      "m.relates_to": {
        rel_type: "m.annotation",
        event_id: eventId,
        key
      }
    });
  } catch (error) {
    console.warn(`Failed to send reaction ${key}:`, error);
  }
}

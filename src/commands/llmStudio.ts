import { CommandContext } from "../types/commandContext";
import { startLlmReactions } from "../utils/llmReactions";
import { buildTrelloSummary, fetchWeather, renderDueTodayLines } from "../services/trelloSummary";

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
  const reactions = reactionTargetId ? startLlmReactions(ctx, reactionTargetId) : null;

  try {
    const normalizedPrompt = prompt.toLowerCase();
    if (normalizedPrompt === "weather") {
      const location = ctx.botConfig.weatherLocation;
      const weather = await fetchWeather(location);
      await sendReply(ctx, ctx.eventId, `${location.name} weather today: ${weather}`);
      return;
    }

    if (normalizedPrompt === "rundown") {
      const location = ctx.botConfig.weatherLocation;
      const summary = await buildTrelloSummary(ctx.trello, location);
      const lines = [
        "Daily Trello summary:",
        `To do: ${summary.todoCount}`,
        `Pending: ${summary.pendingCount}`,
        ...renderDueTodayLines(summary.dueToday, location.timezone),
        `${location.name} weather today: ${summary.weather}`
      ];
      await sendReply(ctx, ctx.eventId, lines.join("\n"));
      return;
    }

    const reply = await ctx.llmStudio.chat(prompt, ctx.botConfig.globalPrompt);
    await sendReply(ctx, ctx.eventId, reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await sendReply(ctx, ctx.eventId, `LLM Studio error: ${message}`);
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
    await sendReply(ctx, event?.event_id ?? ctx.eventId, "The replied-to message has no text to fact check.");
    return true;
  }

  const reactionTargetId = event?.event_id ?? ctx.eventId;
  const reactions = reactionTargetId ? startLlmReactions(ctx, reactionTargetId) : null;
  try {
    const systemPrompt = ctx.botConfig.globalFactcheckPrompt ?? FACTCHECK_SYSTEM_PROMPT;
    const reply = await ctx.llmStudio.chat(repliedBody, systemPrompt);
    await sendReply(ctx, reactionTargetId, reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await sendReply(ctx, reactionTargetId, `LLM Studio error: ${message}`);
  } finally {
    if (reactions) {
      await reactions.finish();
    }
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

async function sendReply(ctx: CommandContext, eventId: string | undefined, body: string): Promise<void> {
  if (!eventId) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body
    });
    return;
  }

  await ctx.client.sendMessage(ctx.roomId, {
    msgtype: "m.text",
    body,
    "m.relates_to": {
      "m.in_reply_to": {
        event_id: eventId
      }
    }
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

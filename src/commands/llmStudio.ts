import { CommandContext } from "../types/commandContext";
import { JellyseerrMovieDetails, JellyseerrSearchResult } from "../connectors/jellyseerr";
import { startLlmReactions } from "../utils/llmReactions";
import { buildTrelloSummary, fetchWeather, renderDueTodayLines } from "../services/trelloSummary";
import { sendErrorReply } from "../utils/errorReactions";

const FACTCHECK_SYSTEM_PROMPT = "You are a fact checker. Check this post.";
const SEERR_REPLY_LIMIT = 500;

export async function handleBlimpfCommand(ctx: CommandContext): Promise<void> {
  const promptCommand = ctx.botConfig.promptCommand;
  const prompt = extractPrompt(ctx.commandBody, promptCommand);
  if (!prompt) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: `Usage: ${promptCommand} PROMPT`
    });
    return;
  }

  const downloadMatch = prompt.match(/^download\s+([\s\S]+)$/i);
  if (downloadMatch) {
    if (!canUseSeerr(ctx)) {
      await ctx.client.sendMessage(ctx.roomId, {
        msgtype: "m.text",
        body: "You are not allowed to request movies."
      });
      return;
    }
  } else if (!ctx.isAllowedUser) {
    await ctx.client.sendMessage(ctx.roomId, {
      msgtype: "m.text",
      body: "You are not allowed to use integration commands."
    });
    return;
  }

  const reactionTargetId = ctx.eventId ?? null;
  const reactions = reactionTargetId ? startLlmReactions(ctx, reactionTargetId) : null;

  try {
    if (downloadMatch) {
      const query = downloadMatch[1].trim();
      if (!query) {
        await sendReply(ctx, ctx.eventId, `Usage: ${promptCommand} download MOVIE NAME`);
        return;
      }
      await handleBlimpfDownload(ctx, query);
      return;
    }

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

    const reply = await ctx.llmStudio.chat(prompt, ctx.botConfig.globalPrompt, ctx.botConfig.llmModel);
    await sendReply(ctx, ctx.eventId, reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await sendErrorReply(ctx, ctx.eventId, `LLM Studio error: ${message}`);
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

export async function handleBlimpfDownloadReplyMessage(
  ctx: CommandContext,
  event: Record<string, any>
): Promise<boolean> {
  if (!canUseSeerr(ctx)) {
    return false;
  }

  const body = String(event?.content?.body ?? "").trim();
  const selectionMatch = body.match(/^([1-5])\s*$/);
  if (!selectionMatch) {
    return false;
  }

  const replyToEventId = getReplyToEventId(event);
  if (!replyToEventId) {
    return false;
  }

  const state = await ctx.stateStore.load();
  const target = state.seerrRequestTargets?.[replyToEventId];
  if (!target) {
    return false;
  }

  const index = Number(selectionMatch[1]) - 1;
  const selection = target.items[index];
  if (!selection) {
    await sendReply(ctx, event?.event_id ?? ctx.eventId, "Selection out of range. Reply with a number 1-5.");
    return true;
  }

  try {
    await ctx.jellyseerr.requestMedia(selection.mediaType, selection.id);
    await sendReply(ctx, event?.event_id ?? ctx.eventId, `Requested: ${selection.title}`);
    await dropSeerrTarget(ctx, replyToEventId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await sendErrorReply(ctx, event?.event_id ?? ctx.eventId, `Seerr error: ${message}`);
  }

  return true;
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
    const reply = await ctx.llmStudio.chat(repliedBody, systemPrompt, ctx.botConfig.llmModel);
    await sendReply(ctx, reactionTargetId, reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await sendErrorReply(ctx, reactionTargetId, `LLM Studio error: ${message}`);
  } finally {
    if (reactions) {
      await reactions.finish();
    }
  }

  return true;
}

async function handleBlimpfDownload(ctx: CommandContext, query: string): Promise<void> {
  try {
    const results = await ctx.jellyseerr.search(query);
    const items = results
      .filter(isMovieOrTvResult)
      .filter((movie) => Number.isInteger(movie.id))
      .slice(0, 5);

    if (items.length === 0) {
      await sendReply(ctx, ctx.eventId, `No movie results found for "${query}".`);
      return;
    }

    const details = await Promise.all(
      items.map(async (item) => ({
        item,
        details: item.id && item.mediaType === "movie" ? await ctx.jellyseerr.getMovieDetails(item.id) : null
      }))
    );

    const lines = [
      `Top ${items.length} Seerr results for "${query}":`,
      "Reply in this thread with a number (1-5) to request the title."
    ];

    details.forEach(({ item, details }, index) => {
      const title = item.title ?? details?.title ?? "Untitled";
      const releaseDate = details?.releaseDate ?? item.releaseDate ?? "Unknown";
      const director = extractDirector(details);
      const language = formatLanguage(details, item) ?? "Unknown";
      const overview = shortenText(details?.overview ?? item.overview ?? "No description available.");
      const label = `${typeEmoji(item.mediaType)} ${title}`;
      lines.push(
        `${index + 1}. ${label}`,
        `Director: ${director} | Released: ${releaseDate} | Language: ${language}`,
        `Description: ${overview}`
      );
    });

    const eventId = await sendReplyWithEventId(ctx, ctx.eventId, lines.join("\n"));
    if (eventId) {
      await rememberSeerrTarget(
        ctx,
        eventId,
        details.map(({ item, details }) => ({
          id: item.id ?? 0,
          title: item.title ?? details?.title ?? "Untitled",
          mediaType: normalizeMediaType(item.mediaType)
        }))
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await sendErrorReply(ctx, ctx.eventId, `Seerr error: ${message}`);
  }
}

function isMovieOrTvResult(result: JellyseerrSearchResult): boolean {
  if (!result) {
    return false;
  }
  const mediaType = result.mediaType?.toLowerCase();
  if (mediaType) {
    return mediaType === "movie" || mediaType === "tv";
  }
  return !!result.title;
}

function extractDirector(details: JellyseerrMovieDetails | null): string {
  const crew = details?.credits?.crew ?? details?.crew;
  const director = crew?.find((member) => member.job?.toLowerCase() === "director");
  return director?.name ?? "Unknown";
}

function formatLanguage(details: JellyseerrMovieDetails | null, result: JellyseerrSearchResult): string | null {
  const spoken = details?.spokenLanguages?.[0];
  if (spoken?.englishName) {
    return spoken.englishName;
  }
  if (spoken?.name) {
    return spoken.name;
  }
  if (spoken?.iso_639_1) {
    return spoken.iso_639_1;
  }
  return details?.originalLanguage ?? result.originalLanguage ?? null;
}

function shortenText(value: string, maxLength = 220): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeMediaType(value?: string): "movie" | "tv" {
  return value?.toLowerCase() === "tv" ? "tv" : "movie";
}

function typeEmoji(value?: string): string {
  return value?.toLowerCase() === "tv" ? "📺" : "🎥";
}

function canUseSeerr(ctx: CommandContext): boolean {
  if (ctx.isAdminUser) {
    return true;
  }
  return ctx.botConfig.seerrAllowedUsers.includes(ctx.sender);
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

async function rememberSeerrTarget(
  ctx: CommandContext,
  eventId: string,
  items: Array<{ id: number; title: string }>
): Promise<void> {
  const filtered = items.filter((item) => Number.isInteger(item.id) && item.id > 0);
  if (filtered.length === 0) {
    return;
  }

  const state = await ctx.stateStore.load();
  const targets = { ...(state.seerrRequestTargets ?? {}) };
  const order = Array.isArray(state.seerrRequestOrder) ? [...state.seerrRequestOrder] : [];

  const existingIndex = order.indexOf(eventId);
  if (existingIndex >= 0) {
    order.splice(existingIndex, 1);
  }

  targets[eventId] = {
    createdAt: new Date().toISOString(),
    items: filtered.map((item) => ({ id: item.id, title: item.title }))
  };
  order.push(eventId);

  if (order.length > SEERR_REPLY_LIMIT) {
    const overflow = order.length - SEERR_REPLY_LIMIT;
    for (let i = 0; i < overflow; i += 1) {
      const stale = order.shift();
      if (stale) {
        delete targets[stale];
      }
    }
  }

  await ctx.stateStore.save({
    seerrRequestTargets: targets,
    seerrRequestOrder: order
  });
}

async function dropSeerrTarget(ctx: CommandContext, eventId: string): Promise<void> {
  const state = await ctx.stateStore.load();
  if (!state.seerrRequestTargets?.[eventId]) {
    return;
  }

  const targets = { ...state.seerrRequestTargets };
  delete targets[eventId];

  const order = Array.isArray(state.seerrRequestOrder) ? state.seerrRequestOrder.filter((id) => id !== eventId) : [];
  await ctx.stateStore.save({
    seerrRequestTargets: targets,
    seerrRequestOrder: order
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

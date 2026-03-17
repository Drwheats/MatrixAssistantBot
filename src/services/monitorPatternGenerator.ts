import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env";

const MAX_PATTERN_LENGTH = 180;
const MIN_PATTERN_LENGTH = 8;

const BASE_MONITOR_SYSTEM_PROMPT = [
  "You convert exactly one log line into exactly one regex fragment for Loki |~ queries.",
  "Your ONLY job is to return a regex that matches similar logs.",
  "Return ONLY the regex fragment.",
  "If you cannot comply exactly, return INVALID_REGEX.",
  "Do not return prose, explanations, JSON, markdown, code fences, labels, prefixes, suffixes, or multiple options.",
  "Do not summarize the log.",
  "Do not describe the log.",
  "Do not explain your reasoning.",
  "Do not think step by step in the output.",
  "Do not wrap the regex in slashes.",
  "Prefer a short literal phrase that captures the stable part of the log.",
  "If a stable event label exists (like 'WebAPI login failure'), return only that phrase.",
  "Generalize dynamic values like timestamps, dates, UUIDs, request ids, counters, hashes, IPs, ports, durations, process ids, and numeric ids.",
  "Do not copy dynamic values literally unless they are part of the stable message shape.",
  "Avoid catastrophic or overly broad patterns. Prefer explicit text and small wildcards over greedy catch-all fragments.",
  "Avoid anchors unless they are clearly necessary.",
  "The regex must compile in JavaScript.",
  "Examples:",
  'Log: 2026-03-11T15:08:47Z Accepted password for mushroom from 192.168.0.1 port 2222 ssh2',
  String.raw`Regex: Accepted password for mushroom from \b\d{1,3}(?:\.\d{1,3}){3}\b port \d+ ssh2`,
  "Log: level=error req_id=4d3c2b1a timeout after 1532ms while syncing user 9182",
  String.raw`Regex: timeout after`,
  "Log: [42911] File error alert: disk /mnt/storage is read-only",
  String.raw`Regex: File error alert: disk /mnt/storage is read-only`,
  'Log: (N) 2026-03-16T22:34:11 - Added new torrent. Torrent: "The Stuff (1985) [1080p] [YTS.AG]"',
  String.raw`Regex: Added new torrent`
].join("\n");

export interface MonitorPatternGenerationOptions {
  customPrompt?: string;
  model?: string;
}

export async function deriveMonitorPattern(
  sample: string,
  options: MonitorPatternGenerationOptions = {}
): Promise<string | null> {
  const normalizedSample = normalizeMonitorSample(sample);
  if (!env.hasLlmStudioCredentials) {
    return buildHeuristicMonitorPattern(normalizedSample);
  }

  const client = new ChatOpenAI({
    apiKey: env.LLM_STUDIO_API_KEY ?? "lm-studio",
    model: options.model ?? env.LLM_STUDIO_MODEL,
    temperature: 0,
    timeout: env.llmStudioTimeoutMs,
    maxTokens: Math.min(env.llmStudioMaxTokens, MAX_PATTERN_LENGTH),
    configuration: {
      baseURL: buildOpenAiCompatibleBaseUrl(env.LLM_STUDIO_BASE_URL)
    }
  });

  const response = await client.invoke([
    new SystemMessage(buildMonitorSystemPrompt(options.customPrompt)),
    new HumanMessage(buildMonitorUserPrompt(normalizedSample))
  ]);

  const candidate = extractMonitorRegexCandidate(response.content);
  if (candidate && validateMonitorPattern(candidate, normalizedSample)) {
    return candidate;
  }

  return buildHeuristicMonitorPattern(normalizedSample);
}

export function buildMonitorSystemPrompt(customPrompt?: string): string {
  const extra = customPrompt?.trim();
  if (!extra) {
    return BASE_MONITOR_SYSTEM_PROMPT;
  }

  return [BASE_MONITOR_SYSTEM_PROMPT, "Additional user instructions:", extra].join("\n\n");
}

export function buildMonitorUserPrompt(sample: string): string {
  return ["Convert this log line into one regex fragment:", sample].join("\n");
}

export function extractMonitorRegexCandidate(content: unknown): string | null {
  const text = flattenMessageContent(content).trim();
  if (!text) {
    return null;
  }
  if (text === "INVALID_REGEX") {
    return null;
  }
  if (text.length > MAX_PATTERN_LENGTH) {
    return null;
  }
  if (text.length < MIN_PATTERN_LENGTH) {
    return null;
  }
  if (/[\r\n]/.test(text)) {
    return null;
  }
  if (text.startsWith("```") || text.endsWith("```")) {
    return null;
  }
  if (/^\/.*\/[dgimsuvy]*$/.test(text)) {
    return null;
  }
  if (/^\{[\s\S]*\}$/.test(text) && /"(pattern|regex)"\s*:/.test(text)) {
    return null;
  }
  if (/^(regex|pattern|output|result)\s*:/i.test(text)) {
    return null;
  }
  if (looksConversational(text)) {
    return null;
  }
  if (!/[\\^$.\[\]()|?*+\]]|(?:\w+\s+\w+)/.test(text)) {
    return null;
  }
  return text;
}

export function validateMonitorPattern(pattern: string, sample: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.length > MAX_PATTERN_LENGTH) {
    return false;
  }
  if (trimmed.length < MIN_PATTERN_LENGTH) {
    return false;
  }
  if (trimmed === "INVALID_REGEX") {
    return false;
  }
  if (/[\r\n]/.test(trimmed)) {
    return false;
  }
  if (looksConversational(trimmed)) {
    return false;
  }

  try {
    const regex = new RegExp(trimmed);
    return regex.test(sample);
  } catch {
    return false;
  }
}

export function buildHeuristicMonitorPattern(sample: string): string | null {
  const normalized = normalizeMonitorSample(sample);
  if (!normalized) {
    return null;
  }

  const phrase = extractStablePhrase(normalized);
  if (phrase) {
    return validateMonitorPattern(phrase, normalized) ? phrase : null;
  }

  const tokens = tokenizeSample(normalized);
  if (tokens.length === 0) {
    return null;
  }

  const pattern = tokens.join("");
  return validateMonitorPattern(pattern, normalized) ? pattern : null;
}

export function buildOpenAiCompatibleBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/chat/completions")) {
    return normalized.slice(0, -"/chat/completions".length);
  }
  if (normalized.endsWith("/api/v1/chat")) {
    return normalized.slice(0, -"/api/v1/chat".length) + "/v1";
  }
  if (normalized.endsWith("/api/v1")) {
    return normalized.slice(0, -"/api/v1".length) + "/v1";
  }
  if (normalized.endsWith("/api")) {
    return normalized.slice(0, -"/api".length) + "/v1";
  }
  if (normalized.endsWith("/v1")) {
    return normalized;
  }
  return `${normalized}/v1`;
}

function flattenMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (!part || typeof part !== "object") {
        return "";
      }

      if ("text" in part && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("");
}

function looksConversational(value: string): boolean {
  return /\b(let'?s|here(?:'s| is)|this regex|this pattern|explanation|because|should match|use this|similar logs|this log entry|appears to be|final plan|wait,|actually,|okay, ready)\b/i.test(
    value
  );
}

function normalizeMonitorSample(sample: string): string {
  let value = sample.trim();
  value = value.replace(/^\([A-Za-z]\)\s*/, "");
  value = value.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\s*-\s*/, "");
  value = value.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\s*/, "");
  return value.trim();
}

function extractStablePhrase(sample: string): string | null {
  const normalized = sample.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const prefixMatch = normalized.match(/^[^:]+(?:success|failure|error|warning|critical|timeout|denied|accepted)[^:]*?/i);
  if (prefixMatch) {
    return prefixMatch[0].trim();
  }

  const beforeDelimiter = normalized.split(/\.\s+|\s+-\s+|,\s+|:\s+/)[0]?.trim();
  if (beforeDelimiter && beforeDelimiter.length >= MIN_PATTERN_LENGTH) {
    return beforeDelimiter;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 4).join(" ");
  }

  return null;
}

function tokenizeSample(sample: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < sample.length) {
    const remainder = sample.slice(index);

    const ipv6MappedIpv4 = remainder.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})/i);
    if (ipv6MappedIpv4) {
      tokens.push(String.raw`(?:::ffff:)?\d{1,3}(?:\.\d{1,3}){3}`);
      index += ipv6MappedIpv4[0].length;
      continue;
    }

    const ipv4 = remainder.match(/^\d{1,3}(?:\.\d{1,3}){3}/);
    if (ipv4) {
      tokens.push(String.raw`\d{1,3}(?:\.\d{1,3}){3}`);
      index += ipv4[0].length;
      continue;
    }

    const uuid = remainder.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/i);
    if (uuid) {
      tokens.push(String.raw`[a-f0-9-]+`);
      index += uuid[0].length;
      continue;
    }

    const quoted = remainder.match(/^"[^"]+"/);
    if (quoted) {
      tokens.push(String.raw`".*?"`);
      index += quoted[0].length;
      continue;
    }

    const port = remainder.match(/^\d+/);
    if (port) {
      tokens.push(String.raw`\d+`);
      index += port[0].length;
      continue;
    }

    const whitespace = remainder.match(/^\s+/);
    if (whitespace) {
      tokens.push(String.raw`\s+`);
      index += whitespace[0].length;
      continue;
    }

    const text = remainder.match(/^[^\s\d":]+/);
    if (text) {
      tokens.push(escapeRegex(text[0]));
      index += text[0].length;
      continue;
    }

    tokens.push(escapeRegex(sample[index]));
    index += 1;
  }

  return compactWildcards(tokens);
}

function compactWildcards(tokens: string[]): string[] {
  const compacted: string[] = [];
  for (const token of tokens) {
    const previous = compacted[compacted.length - 1];
    if (token === String.raw`\s+` && previous === String.raw`\s+`) {
      continue;
    }
    compacted.push(token);
  }
  return compacted;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

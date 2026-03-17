import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { env } from "../config/env";

const MAX_PATTERN_LENGTH = 180;

const BASE_MONITOR_SYSTEM_PROMPT = [
  "You convert exactly one log line into exactly one regex fragment for Loki |~ queries.",
  "Your ONLY job is to return a regex that matches similar logs.",
  "Return ONLY the regex fragment.",
  "Do not return prose, explanations, JSON, markdown, code fences, labels, prefixes, suffixes, or multiple options.",
  "Do not wrap the regex in slashes.",
  "Prefer a concise regex that keeps the stable wording and structure of the log.",
  "Generalize dynamic values like timestamps, dates, UUIDs, request ids, counters, hashes, IPs, ports, durations, process ids, and numeric ids.",
  "Do not copy dynamic values literally unless they are part of the stable message shape.",
  "Avoid catastrophic or overly broad patterns. Prefer explicit text and small wildcards over greedy catch-all fragments.",
  "Avoid anchors unless they are clearly necessary.",
  "The regex must compile in JavaScript.",
  "Examples:",
  'Log: 2026-03-11T15:08:47Z Accepted password for mushroom from 192.168.0.1 port 2222 ssh2',
  String.raw`Regex: Accepted password for mushroom from \b\d{1,3}(?:\.\d{1,3}){3}\b port \d+ ssh2`,
  "Log: level=error req_id=4d3c2b1a timeout after 1532ms while syncing user 9182",
  String.raw`Regex: level=error req_id=[a-f0-9-]+ timeout after \d+ms while syncing user \d+`,
  "Log: [42911] File error alert: disk /mnt/storage is read-only",
  String.raw`Regex: File error alert: disk /mnt/storage is read-only`
].join("\n");

export interface MonitorPatternGenerationOptions {
  customPrompt?: string;
  model?: string;
}

export async function deriveMonitorPattern(
  sample: string,
  options: MonitorPatternGenerationOptions = {}
): Promise<string | null> {
  if (!env.hasLlmStudioCredentials) {
    return null;
  }

  const client = new ChatOpenAI({
    apiKey: env.LLM_STUDIO_API_KEY ?? "lm-studio",
    model: options.model ?? env.LLM_STUDIO_MODEL,
    temperature: env.llmStudioTemperature,
    timeout: env.llmStudioTimeoutMs,
    maxTokens: Math.min(env.llmStudioMaxTokens, MAX_PATTERN_LENGTH),
    configuration: {
      baseURL: buildOpenAiCompatibleBaseUrl(env.LLM_STUDIO_BASE_URL)
    }
  });

  const response = await client.invoke([
    new SystemMessage(buildMonitorSystemPrompt(options.customPrompt)),
    new HumanMessage(buildMonitorUserPrompt(sample))
  ]);

  const candidate = extractMonitorRegexCandidate(response.content);
  if (!candidate) {
    return null;
  }

  return validateMonitorPattern(candidate, sample) ? candidate : null;
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
  if (text.length > MAX_PATTERN_LENGTH) {
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
  return text;
}

export function validateMonitorPattern(pattern: string, sample: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.length > MAX_PATTERN_LENGTH) {
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
  return /\b(here(?:'s| is)|this regex|this pattern|explanation|because|should match|use this|similar logs)\b/i.test(value);
}

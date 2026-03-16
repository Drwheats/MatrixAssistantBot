import { env } from "../config/env";

interface ChatCompletionResponse {
  output?: string | Array<string | { content?: string; text?: string }>;
  message?: { content?: string };
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string } | string;
}

export class LlmStudioConnector {
  private activeRequests = 0;

  isBusy(): boolean {
    return this.activeRequests > 0;
  }

  async chat(prompt: string, systemPrompt?: string): Promise<string> {
    this.activeRequests += 1;
    if (!env.hasLlmStudioCredentials) {
      this.activeRequests -= 1;
      throw new Error("LLM Studio is not configured.");
    }

    try {
      const body: Record<string, unknown> = {
        model: env.LLM_STUDIO_MODEL,
        ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
        input: prompt,
        stream: false
      };

      if (typeof env.llmStudioTemperature === "number") {
        body.temperature = env.llmStudioTemperature;
      }

      const baseTimeout = env.llmStudioTimeoutMs;
      const timeouts = [
        baseTimeout,
        Math.max(baseTimeout * 2, baseTimeout + 30_000),
        Math.max(baseTimeout * 3, baseTimeout + 60_000)
      ];

      let lastError: Error | null = null;
      for (let attempt = 0; attempt < timeouts.length; attempt += 1) {
        try {
          const response = await fetch(buildChatUrl(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(env.LLM_STUDIO_API_KEY ? { Authorization: `Bearer ${env.LLM_STUDIO_API_KEY}` } : {})
            },
            body: JSON.stringify(body),
            signal: timeoutSignal(timeouts[attempt])
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(`LLM Studio error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`);
          }

          const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
          let data: ChatCompletionResponse | null = null;
          let rawText: string | null = null;
          try {
            data = (await response.json()) as ChatCompletionResponse;
          } catch {
            rawText = await response.text();
          }

          if (data?.error) {
            const message = typeof data.error === "string" ? data.error : data.error.message ?? "Unknown error";
            if (attempt < timeouts.length - 1 && isTimeoutMessage(message)) {
              lastError = new Error(`LLM Studio error: ${message}`);
              continue;
            }
            throw new Error(`LLM Studio error: ${message}`);
          }

          let content: string | null = null;
          if (data) {
            content = stripThinking(extractContent(data));
          } else if (rawText) {
            content = stripThinking(parseStreamedContent(rawText, contentType));
          }

          if (!content) {
            throw new Error("LLM Studio returned an empty response.");
          }

          return content;
        } catch (error) {
          if (attempt < timeouts.length - 1 && isTimeoutError(error)) {
            lastError = error instanceof Error ? error : new Error(String(error));
            continue;
          }
          throw error;
        }
      }

      if (lastError) {
        throw lastError;
      }

      throw new Error("LLM Studio failed unexpectedly.");
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    }
  }
}

function buildChatUrl(): string {
  const base = env.LLM_STUDIO_BASE_URL.replace(/\/+$/, "");
  if (base.endsWith("/api/v1/chat")) {
    return base;
  }
  if (base.endsWith("/api/v1")) {
    return `${base}/chat`;
  }
  if (base.endsWith("/api")) {
    return `${base}/v1/chat`;
  }
  return `${base}/api/v1/chat`;
}

function extractContent(data: ChatCompletionResponse): string | null {
  if (typeof data.output === "string") {
    return data.output.trim();
  }

  if (Array.isArray(data.output)) {
    const parts = data.output
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          if (typeof item.content === "string") {
            return item.content;
          }
          if (typeof item.text === "string") {
            return item.text;
          }
        }
        return "";
      })
      .join("");
    const trimmed = parts.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  const message = data.message?.content?.trim();
  if (message) {
    return message;
  }

  const choice = data.choices?.[0]?.message?.content?.trim();
  if (choice) {
    return choice;
  }

  return null;
}

function parseStreamedContent(payload: string, contentType: string): string | null {
  const trimmed = payload.trim();
  if (!trimmed) {
    return null;
  }

  if (!contentType.includes("text/event-stream") && !trimmed.includes("\n")) {
    try {
      const parsed = JSON.parse(trimmed) as ChatCompletionResponse;
      return extractContent(parsed);
    } catch {
      return trimmed;
    }
  }

  const lines = trimmed.split(/\r?\n/);
  const chunks: string[] = [];

  for (const line of lines) {
    const raw = line.trim();
    if (!raw || !raw.startsWith("data:")) {
      continue;
    }
    const data = raw.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(data) as any;
      const delta = parsed?.choices?.[0]?.delta?.content;
      const message = parsed?.choices?.[0]?.message?.content;
      const output = parsed?.output;
      if (typeof delta === "string" && delta.length > 0) {
        chunks.push(delta);
        continue;
      }
      if (typeof message === "string" && message.length > 0) {
        chunks.push(message);
        continue;
      }
      if (typeof output === "string" && output.length > 0) {
        chunks.push(output);
      }
    } catch {
      continue;
    }
  }

  const combined = chunks.join("").trim();
  return combined.length > 0 ? combined : null;
}

function stripThinking(content: string | null): string | null {
  if (!content) {
    return content;
  }

  let cleaned = content;

  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const lines = cleaned.split(/\r?\n/);
  const lowerLines = lines.map((line) => line.toLowerCase());
  const thinkingIndex = lowerLines.findIndex((line) => line.startsWith("thinking process"));
  const hasThinkingMarker =
    thinkingIndex >= 0 ||
    lowerLines.some((line) =>
      ["analysis:", "reasoning:", "chain of thought", "final decision", "fact check:"].some((marker) =>
        line.includes(marker)
      )
    );

  if (hasThinkingMarker) {
    const isListLine = (line: string) => /^\s*(\d+\.|[-*+]|•)\s+/.test(line);
    const isMetaLine = (line: string) =>
      /^(\s*final\b|\s*answer\b|\s*response\b|\s*output\b|\s*fact check\b|\s*thinking process\b)/i.test(line);

    let startIndex: number | null = null;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) {
        continue;
      }
      if (isListLine(line) || isMetaLine(line) || line.startsWith("*")) {
        continue;
      }
      if (i === 0 || lines[i - 1].trim().length === 0) {
        startIndex = i;
        break;
      }
    }

    if (startIndex !== null) {
      cleaned = lines.slice(startIndex).join("\n").trim();
    }
  }

  return cleaned.length > 0 ? cleaned : null;
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return undefined;
  }
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

function isTimeoutError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return isTimeoutMessage(message) || message.toLowerCase().includes("abort");
}

function isTimeoutMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("timeout") || normalized.includes("timed out");
}

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
        input: prompt
      };

      if (typeof env.llmStudioTemperature === "number") {
        body.temperature = env.llmStudioTemperature;
      }

      const response = await fetch(buildChatUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(env.LLM_STUDIO_API_KEY ? { Authorization: `Bearer ${env.LLM_STUDIO_API_KEY}` } : {})
        },
        body: JSON.stringify(body),
        signal: timeoutSignal(env.llmStudioTimeoutMs)
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM Studio error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      if (data.error) {
        const message = typeof data.error === "string" ? data.error : data.error.message ?? "Unknown error";
        throw new Error(`LLM Studio error: ${message}`);
      }

      const content = extractContent(data);
      if (!content) {
        throw new Error("LLM Studio returned an empty response.");
      }

      return content;
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

function timeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

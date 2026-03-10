import { env } from "../config/env";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class LlmStudioConnector {
  async chat(prompt: string, systemPrompt?: string): Promise<string> {
    if (!env.hasLlmStudioCredentials) {
      throw new Error("LLM Studio is not configured.");
    }

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const response = await fetch(buildChatCompletionsUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.LLM_STUDIO_API_KEY ? { Authorization: `Bearer ${env.LLM_STUDIO_API_KEY}` } : {})
      },
      body: JSON.stringify({
        model: env.LLM_STUDIO_MODEL,
        messages,
        temperature: env.llmStudioTemperature,
        max_tokens: env.llmStudioMaxTokens
      }),
      signal: timeoutSignal(env.llmStudioTimeoutMs)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM Studio error: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    if (data.error?.message) {
      throw new Error(`LLM Studio error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LLM Studio returned an empty response.");
    }

    return content;
  }
}

function buildChatCompletionsUrl(): string {
  const base = env.LLM_STUDIO_BASE_URL.replace(/\/+$/, "");
  if (base.endsWith("/v1")) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

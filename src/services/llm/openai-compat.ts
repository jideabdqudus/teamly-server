import OpenAI from "openai";
import { LLMResponse, ModelName } from "../../types";

interface CompatConfig {
  name: ModelName;
  model: string;
  baseURL?: string; // omit for OpenAI
  maxTokens?: number;
  extractCitations?: boolean;
}

export interface ProviderImpl {
  query: (prompt: string, apiKey: string) => Promise<LLMResponse>;
  validate: (apiKey: string) => Promise<void>;
}

export function createChatCompletionProvider(cfg: CompatConfig): ProviderImpl {
  return {
    async query(prompt, apiKey) {
      const client = new OpenAI({ apiKey, baseURL: cfg.baseURL });
      const completion = await client.chat.completions.create({
        model: cfg.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: cfg.maxTokens ?? 1024,
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      const citations = cfg.extractCitations
        ? (completion as unknown as { citations?: string[] }).citations
        : undefined;

      return {
        raw,
        model: cfg.name,
        tokens_used: completion.usage?.total_tokens ?? 0,
        citations,
      };
    },

    async validate(apiKey) {
      const client = new OpenAI({ apiKey, baseURL: cfg.baseURL });
      await client.chat.completions.create({
        model: cfg.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      });
    },
  };
}

import Anthropic from "@anthropic-ai/sdk";
import { LLMResponse } from "../../types";
import { ProviderImpl } from "./openai-compat";

const MODEL = "claude-opus-5";

/**
 * Claude via the Anthropic SDK (BYOK). We capture the user-facing answer, so we
 * disable thinking (allowed at the default `high` effort on Opus 5) — this keeps
 * the full response text within `max_tokens` and avoids paying for reasoning we
 * never read.
 */
export const claudeProvider: ProviderImpl = {
  async query(prompt, apiKey) {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const tokens =
      (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0);

    return { raw, model: "Claude", tokens_used: tokens };
  },

  async validate(apiKey) {
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: MODEL,
      max_tokens: 16,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: "ping" }],
    });
  },
};

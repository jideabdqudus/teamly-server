import OpenAI from 'openai';
import { env } from '../../config/env';
import { LLMResponse } from '../../types';

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

/**
 * Query ChatGPT (gpt-4o) with the given prompt.
 */
export async function queryChatGPT(prompt: string): Promise<LLMResponse> {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1024,
  });

  const raw = completion.choices[0]?.message?.content ?? '';

  return {
    raw,
    model: 'ChatGPT',
    tokens_used: completion.usage?.total_tokens ?? 0,
  };
}

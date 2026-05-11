import { ModelName, LLMResponse, LLMProvider } from '../../types';
import { queryChatGPT } from './openai';

// ─── Provider Registry ───────────────────────────────────────────────────────
// To add a new provider:
//   1. Create a new file in services/llm/ (e.g., anthropic.ts)
//   2. Implement the LLMProvider signature: (prompt: string) => Promise<LLMResponse>
//   3. Import it and add an entry to PROVIDERS below
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDERS: Partial<Record<ModelName, LLMProvider>> = {
  'ChatGPT': queryChatGPT,
  // 'Claude':          queryClaude,     // from ./anthropic
  // 'Gemini':          queryGemini,     // from ./google
  // 'Perplexity':      queryPerplexity, // from ./perplexity
  // 'Grok':            queryGrok,       // from ./xai
  // 'AI Overviews':    queryAIOverviews,    // from ./serpapi
  // 'Google AI Mode':  queryGoogleAIMode,   // from ./serpapi
};

export async function queryLLM(model: ModelName, prompt: string): Promise<LLMResponse> {
  const provider = PROVIDERS[model];
  if (!provider) {
    throw new Error(`LLM provider not configured for model: ${model}`);
  }
  return provider(prompt);
}

export function getSupportedModels(): ModelName[] {
  return Object.keys(PROVIDERS) as ModelName[];
}

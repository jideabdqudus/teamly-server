import { createChatCompletionProvider } from "./openai-compat";

export const perplexityProvider = createChatCompletionProvider({
  name: "Perplexity",
  model: "sonar",
  baseURL: "https://api.perplexity.ai",
  extractCitations: true,
});

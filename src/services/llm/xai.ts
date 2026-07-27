import { createChatCompletionProvider } from "./openai-compat";

export const grokProvider = createChatCompletionProvider({
  name: "Grok",
  model: "grok-2-latest",
  baseURL: "https://api.x.ai/v1",
});

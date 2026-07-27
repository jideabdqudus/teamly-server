import { createChatCompletionProvider } from "./openai-compat";

export const chatgptProvider = createChatCompletionProvider({
  name: "ChatGPT",
  model: "gpt-4o",
});

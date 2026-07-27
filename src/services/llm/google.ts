import { GoogleGenerativeAI } from "@google/generative-ai";
import { ProviderImpl } from "./openai-compat";

const MODEL = "gemini-2.0-flash";

export const geminiProvider: ProviderImpl = {
  async query(prompt, apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);

    return {
      raw: result.response.text(),
      model: "Gemini",
      tokens_used: result.response.usageMetadata?.totalTokenCount ?? 0,
    };
  },

  async validate(apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL });
    await model.generateContent("ping");
  },
};

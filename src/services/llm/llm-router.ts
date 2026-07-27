import { ModelName, LLMResponse } from "../../types";
import { supabase } from "../../config/supabase";
import { ProviderImpl } from "./openai-compat";
import { chatgptProvider } from "./openai";
import { claudeProvider } from "./anthropic";
import { geminiProvider } from "./google";
import { grokProvider } from "./xai";
import { perplexityProvider } from "./perplexity";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "perplexity";

export const PROVIDER_IDS: ProviderId[] = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "perplexity",
];

const PROVIDERS: Record<ProviderId, ProviderImpl> = {
  openai: chatgptProvider,
  anthropic: claudeProvider,
  google: geminiProvider,
  xai: grokProvider,
  perplexity: perplexityProvider,
};

const MODEL_PROVIDER: Partial<Record<ModelName, ProviderId>> = {
  ChatGPT: "openai",
  Claude: "anthropic",
  Gemini: "google",
  Grok: "xai",
  Perplexity: "perplexity",
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as string[]).includes(value);
}

export function getProviderForModel(model: ModelName): ProviderId | null {
  return MODEL_PROVIDER[model] ?? null;
}

export function getModelForProvider(provider: ProviderId): ModelName | null {
  const entry = (
    Object.entries(MODEL_PROVIDER) as [ModelName, ProviderId][]
  ).find(([, p]) => p === provider);
  return entry ? entry[0] : null;
}

export async function loadKeyedProviders(
  accountId: string,
): Promise<Set<ProviderId>> {
  const { data } = await supabase
    .from("provider_keys")
    .select("provider")
    .eq("account_id", accountId);
  return new Set((data ?? []).map((k) => k.provider as ProviderId));
}

export function isModelRunnable(
  model: ModelName,
  keyedProviders: Set<ProviderId>,
): boolean {
  const provider = getProviderForModel(model);
  return provider !== null && keyedProviders.has(provider);
}

export async function queryLLM(
  model: ModelName,
  prompt: string,
  apiKey: string,
): Promise<LLMResponse> {
  const provider = MODEL_PROVIDER[model];
  if (!provider) {
    throw new Error(`No provider configured for model: ${model}`);
  }
  return PROVIDERS[provider].query(prompt, apiKey);
}

export async function validateProviderKey(
  provider: ProviderId,
  apiKey: string,
): Promise<void> {
  await PROVIDERS[provider].validate(apiKey);
}

export type ModelName =
  | "ChatGPT"
  | "Claude"
  | "Gemini"
  | "Perplexity"
  | "Grok"
  | "AI Overviews"
  | "Google AI Mode";

export type ScanStatus = "pending" | "running" | "completed" | "failed";
export type ScanTrigger = "cron" | "manual" | "onboarding";
export type ResponseStatus = "pending" | "success" | "failed";
export type BrandSentiment = "positive" | "neutral" | "negative";
export type MentionType = "brand" | "competitor";
export type AlertRuleType =
  | "visibility_drop"
  | "competitor_overtake"
  | "new_citation";

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Brand {
  id: string;
  account_id: string;
  name: string;
  brand_name: string;
  domain?: string;
  industry?: string;
  enabled_models: ModelName[];
  created_at: string;
  updated_at: string;
}

export interface Prompt {
  id: string;
  brand_id: string;
  text: string;
  country: string;
  country_code: string;
  language: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Competitor {
  id: string;
  brand_id: string;
  name: string;
  domain?: string;
  created_at: string;
}

export interface Scan {
  id: string;
  brand_id: string;
  status: ScanStatus;
  triggered_by: ScanTrigger;
  total_tasks: number;
  completed_tasks: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface Response {
  id: string;
  scan_id: string;
  brand_id: string;
  prompt_id: string;
  model: ModelName;
  status: ResponseStatus;
  raw_response?: string;
  snippet?: string;
  brand_mentioned: boolean;
  mention_position?: number;
  brand_sentiment?: BrandSentiment;
  queried_at: string;
  created_at: string;
}

export interface Mention {
  id: string;
  response_id: string;
  brand_id: string;
  name: string;
  type: MentionType;
  position?: number;
  created_at: string;
}

export interface Citation {
  id: string;
  response_id: string;
  brand_id: string;
  prompt_id: string;
  url: string;
  domain: string;
  title?: string;
  model: ModelName;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
}

export interface VisibilityDaily {
  id: string;
  brand_id: string;
  scan_id?: string;
  date: string;
  score: number;
  total_responses: number;
  total_mentions: number;
  total_citations: number;
  model_scores: Partial<Record<ModelName, number>>;
  created_at: string;
}

export interface PromptVisibilityDaily {
  id: string;
  brand_id: string;
  prompt_id: string;
  date: string;
  score: number;
  mentions: number;
  responses: number;
  citations: number;
  avg_position?: number;
  created_at: string;
}

export interface AlertRule {
  id: string;
  brand_id: string;
  type: AlertRuleType;
  enabled: boolean;
  threshold?: number;
  created_at: string;
  updated_at: string;
}

export interface AlertHistory {
  id: string;
  brand_id: string;
  rule_id?: string;
  type: AlertRuleType;
  message: string;
  read: boolean;
  created_at: string;
}

export interface LLMResponse {
  raw: string;
  model: ModelName;
  tokens_used: number;
  citations?: string[];
  no_result?: boolean;
}

export type LLMProvider = (
  prompt: string,
  apiKey: string,
) => Promise<LLMResponse>;

export interface ScanOrchestrateJob {
  brand_id?: string;
  account_id?: string;
  scan_id?: string;
  triggered_by: ScanTrigger;
  prompt_ids?: string[];
  model_ids?: ModelName[];
}

export interface LLMQueryJob {
  scan_id: string;
  brand_id: string;
  account_id: string;
  prompt_id: string;
  model: ModelName;
  prompt_text: string;
  brand_name: string;
}

export interface AnalysisJob {
  response_id: string;
  brand_id: string;
  brand_name: string;
  competitor_names: string[];
  api_citations?: string[];
}

export interface ScoringJob {
  scan_id: string;
  brand_id: string;
}

export interface AlertJob {
  scan_id: string;
  brand_id: string;
}

export interface RequestUser {
  user_id: string;
  account_id: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;

      brand_id?: string;
    }
  }
}

export type PlanTier = 'free' | 'starter' | 'pro' | 'agency';

export type ModelName =
  | 'ChatGPT'
  | 'Claude'
  | 'Gemini'
  | 'Perplexity'
  | 'Grok'
  | 'AI Overviews'
  | 'Google AI Mode';

export type ScanStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ScanTrigger = 'cron' | 'manual' | 'onboarding';
export type ResponseStatus = 'pending' | 'success' | 'failed';
export type BrandSentiment = 'positive' | 'neutral' | 'negative';
export type MentionType = 'brand' | 'competitor';
export type AlertRuleType = 'visibility_drop' | 'competitor_overtake' | 'new_citation';

// ---- Auth ----
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

// ---- Organization ----
export interface Organization {
  id: string;
  user_id: string;
  name: string;
  domain?: string;
  industry?: string;
  brand_name: string;
  plan_tier: PlanTier;
  enabled_models: ModelName[];
  created_at: string;
  updated_at: string;
}

// ---- Prompt ----
export interface Prompt {
  id: string;
  org_id: string;
  text: string;
  country: string;
  country_code: string;
  language: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ---- Competitor ----
export interface Competitor {
  id: string;
  org_id: string;
  name: string;
  domain?: string;
  created_at: string;
}

// ---- Scan ----
export interface Scan {
  id: string;
  org_id: string;
  status: ScanStatus;
  triggered_by: ScanTrigger;
  total_tasks: number;
  completed_tasks: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

// ---- Response ----
export interface Response {
  id: string;
  scan_id: string;
  org_id: string;
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

// ---- Mention ----
export interface Mention {
  id: string;
  response_id: string;
  org_id: string;
  name: string;
  type: MentionType;
  position?: number;
  created_at: string;
}

// ---- Citation ----
export interface Citation {
  id: string;
  response_id: string;
  org_id: string;
  prompt_id: string;
  url: string;
  domain: string;
  title?: string;
  model: ModelName;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
}

// ---- Visibility ----
export interface VisibilityDaily {
  id: string;
  org_id: string;
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
  org_id: string;
  prompt_id: string;
  date: string;
  score: number;
  mentions: number;
  responses: number;
  citations: number;
  avg_position?: number;
  created_at: string;
}

// ---- Alert ----
export interface AlertRule {
  id: string;
  org_id: string;
  type: AlertRuleType;
  enabled: boolean;
  threshold?: number;
  created_at: string;
  updated_at: string;
}

export interface AlertHistory {
  id: string;
  org_id: string;
  rule_id?: string;
  type: AlertRuleType;
  message: string;
  read: boolean;
  created_at: string;
}

// ---- LLM Pipeline ----
export interface LLMResponse {
  raw: string;
  model: ModelName;
  tokens_used: number;
  citations?: string[];
  no_result?: boolean;
}

export type LLMProvider = (prompt: string) => Promise<LLMResponse>;

// ---- Worker job payloads ----
export interface ScanOrchestrateJob {
  org_id: string;
  scan_id?: string;
  triggered_by: ScanTrigger;
  prompt_ids?: string[];
  model_ids?: ModelName[];
}

export interface LLMQueryJob {
  scan_id: string;
  org_id: string;
  prompt_id: string;
  model: ModelName;
  prompt_text: string;
  brand_name: string;
}

export interface AnalysisJob {
  response_id: string;
  org_id: string;
  brand_name: string;
  competitor_names: string[];
  api_citations?: string[];
}

export interface ScoringJob {
  scan_id: string;
  org_id: string;
}

export interface AlertJob {
  scan_id: string;
  org_id: string;
}

// ---- Express request augmentation ----
export interface RequestUser {
  user_id: string;
  org_id: string;
  plan_tier: PlanTier;
}

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}

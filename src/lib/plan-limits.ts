import { PlanTier } from '../types';

interface PlanLimits {
  prompts: number;
  models: number;
  history_days: number;
  competitors: number;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free:    { prompts: 3,   models: 1, history_days: 7,   competitors: 1 },
  starter: { prompts: 25,  models: 3, history_days: 30,  competitors: 3 },
  pro:     { prompts: 100, models: 7, history_days: 90,  competitors: 5 },
  agency:  { prompts: 500, models: 7, history_days: 365, competitors: 10 },
};

export function getLimits(tier: PlanTier): PlanLimits {
  return PLAN_LIMITS[tier];
}

export function canAddPrompt(tier: PlanTier, currentCount: number): boolean {
  return currentCount < PLAN_LIMITS[tier].prompts;
}

export function canAddCompetitor(tier: PlanTier, currentCount: number): boolean {
  return currentCount < PLAN_LIMITS[tier].competitors;
}

export function getAllowedModelCount(tier: PlanTier): number {
  return PLAN_LIMITS[tier].models;
}

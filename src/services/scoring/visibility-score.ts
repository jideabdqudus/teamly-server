import { ModelName } from '../../types';

interface ResponseRecord {
  id: string;
  prompt_id: string;
  model: ModelName;
  brand_mentioned: boolean;
}

interface PromptScore {
  prompt_id: string;
  score: number;
  responses: number;
  mentions: number;
}

interface OrgScore {
  score: number;
  by_prompt: PromptScore[];
  by_model: Partial<Record<ModelName, number>>;
  total_responses: number;
  total_mentions: number;
}

/**
 * Calculates the org-level composite visibility score (0–100)
 * and per-prompt/per-model breakdowns.
 */
export function calculateVisibilityScore(responses: ResponseRecord[]): OrgScore {
  if (responses.length === 0) {
    return { score: 0, by_prompt: [], by_model: {}, total_responses: 0, total_mentions: 0 };
  }

  // Group by prompt
  const byPrompt = new Map<string, { total: number; mentioned: number }>();
  const byModel = new Map<ModelName, { total: number; mentioned: number }>();

  for (const r of responses) {
    // Per prompt
    const p = byPrompt.get(r.prompt_id) ?? { total: 0, mentioned: 0 };
    p.total++;
    if (r.brand_mentioned) p.mentioned++;
    byPrompt.set(r.prompt_id, p);

    // Per model
    const m = byModel.get(r.model) ?? { total: 0, mentioned: 0 };
    m.total++;
    if (r.brand_mentioned) m.mentioned++;
    byModel.set(r.model, m);
  }

  // Per-prompt scores
  const promptScores: PromptScore[] = [];
  let weightedSum = 0;
  let weightTotal = 0;

  for (const [prompt_id, stats] of byPrompt.entries()) {
    const score = stats.total > 0 ? Math.round((stats.mentioned / stats.total) * 100) : 0;
    promptScores.push({
      prompt_id,
      score,
      responses: stats.total,
      mentions: stats.mentioned,
    });
    // Weight by response count (more responses = more reliable signal)
    weightedSum += score * stats.total;
    weightTotal += stats.total;
  }

  const orgScore = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;

  // Per-model scores
  const modelScores: Partial<Record<ModelName, number>> = {};
  for (const [model, stats] of byModel.entries()) {
    modelScores[model] = stats.total > 0 ? Math.round((stats.mentioned / stats.total) * 100) : 0;
  }

  const totalMentions = responses.filter((r) => r.brand_mentioned).length;

  return {
    score: orgScore,
    by_prompt: promptScores,
    by_model: modelScores,
    total_responses: responses.length,
    total_mentions: totalMentions,
  };
}

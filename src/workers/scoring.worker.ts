import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { supabase } from '../config/supabase';
import { childLogger } from '../config/logger';
import { alertQueue } from '../queues';
import { ScoringJob } from '../types';
import { calculateVisibilityScore } from '../services/scoring/visibility-score';
import { calculateSOV } from '../services/scoring/sov-calculator';

const log = childLogger({ worker: 'scoring' });

export function createScoringWorker(): Worker {
  return new Worker<ScoringJob>(
    'scoring',
    async (job: Job<ScoringJob>) => {
      const { scan_id, org_id } = job.data;
      const today = new Date().toISOString().split('T')[0];

      log.info({ job_id: job.id, scan_id, org_id }, 'scoring start');

      // Load all responses for this scan
      const { data: responses } = await supabase
        .from('responses')
        .select('id, prompt_id, model, brand_mentioned')
        .eq('scan_id', scan_id)
        .eq('status', 'success');

      if (!responses || responses.length === 0) {
        log.warn({ scan_id, org_id }, 'no successful responses for scan — scoring skipped');
        return;
      }

      // Calculate visibility scores
      const scores = calculateVisibilityScore(responses as Parameters<typeof calculateVisibilityScore>[0]);

      // Write per-prompt visibility
      for (const ps of scores.by_prompt) {
        const { data: citations } = await supabase
          .from('citations')
          .select('id', { count: 'exact' })
          .eq('org_id', org_id)
          .eq('prompt_id', ps.prompt_id)
          .gte('last_seen_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        await supabase
          .from('prompt_visibility_daily')
          .upsert(
            {
              org_id,
              prompt_id: ps.prompt_id,
              date: today,
              score: ps.score,
              mentions: ps.mentions,
              responses: ps.responses,
              citations: citations?.length ?? 0,
            },
            { onConflict: 'org_id,prompt_id,date' },
          );
      }

      // Load all mentions for SOV calculation
      const { data: mentions } = await supabase
        .from('mentions')
        .select('name, type')
        .eq('org_id', org_id)
        .in('response_id', responses.map((r) => r.id));

      const sovResults = calculateSOV((mentions ?? []) as Parameters<typeof calculateSOV>[0]);
      const totalCitations = await supabase
        .from('citations')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', org_id);

      // Write org-level visibility_daily
      await supabase
        .from('visibility_daily')
        .upsert(
          {
            org_id,
            scan_id,
            date: today,
            score: scores.score,
            total_responses: scores.total_responses,
            total_mentions: scores.total_mentions,
            total_citations: totalCitations.count ?? 0,
            model_scores: scores.by_model,
          },
          { onConflict: 'org_id,date' },
        );

      log.info(
        {
          scan_id,
          org_id,
          score: scores.score,
          total_responses: scores.total_responses,
          total_mentions: scores.total_mentions,
          sov_entries: sovResults.length,
        },
        'scoring complete',
      );

      // Trigger alert evaluation
      await alertQueue.add('evaluate', { scan_id, org_id });
    },
    {
      connection: redis,
      concurrency: 1,
    },
  );
}

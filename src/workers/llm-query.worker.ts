import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { supabase } from '../config/supabase';
import { childLogger } from '../config/logger';
import { analysisQueue, scoringQueue } from '../queues';
import { LLMQueryJob } from '../types';
import { queryLLM } from '../services/llm/llm-router';

const log = childLogger({ worker: 'llm-query' });

export function createLLMQueryWorker(): Worker {
  return new Worker<LLMQueryJob>(
    'llm-query',
    async (job: Job<LLMQueryJob>) => {
      const { scan_id, org_id, prompt_id, model, prompt_text, brand_name } = job.data;

      log.info({ job_id: job.id, scan_id, org_id, prompt_id, model }, 'llm query start');

      let responseId: string | null = null;

      // Create a pending response record first
      const { data: responseRecord } = await supabase
        .from('responses')
        .insert({
          scan_id,
          org_id,
          prompt_id,
          model,
          status: 'pending',
          queried_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      responseId = responseRecord?.id ?? null;

      try {
        // Query the LLM
        const llmResult = await queryLLM(model, prompt_text);

        const snippet = llmResult.raw.slice(0, 300);

        // Update the response record with results
        await supabase
          .from('responses')
          .update({
            status: 'success',
            raw_response: llmResult.raw,
            snippet,
          })
          .eq('id', responseId);

        // Enqueue analysis job
        if (responseId) {
          await analysisQueue.add('analyse', {
            response_id: responseId,
            org_id,
            brand_name,
            competitor_names: [], // Will be loaded by analysis worker
            api_citations: llmResult.citations,
          });
        }
      } catch (err) {
        log.error({ err, scan_id, org_id, prompt_id, model, response_id: responseId }, 'llm query failed');
        if (responseId) {
          await supabase
            .from('responses')
            .update({ status: 'failed' })
            .eq('id', responseId);
        }
      } finally {
        // Increment completed_tasks and check if scan is done
        const { data: scan } = await supabase
          .from('scans')
          .select('total_tasks, completed_tasks')
          .eq('id', scan_id)
          .single();

        if (scan) {
          const newCompleted = scan.completed_tasks + 1;
          const updates: Record<string, unknown> = { completed_tasks: newCompleted };

          if (newCompleted >= scan.total_tasks) {
            updates.status = 'completed';
            updates.completed_at = new Date().toISOString();
          }

          await supabase.from('scans').update(updates).eq('id', scan_id);

          // When all LLM jobs complete, trigger scoring
          if (newCompleted >= scan.total_tasks) {
            await scoringQueue.add('score', { scan_id, org_id });
            log.info({ scan_id, org_id }, 'scan complete, scoring enqueued');
          }
        }
      }
    },
    {
      connection: redis,
      concurrency: 10,
    },
  );
}

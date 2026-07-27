import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { supabase } from '../config/supabase';
import { childLogger } from '../config/logger';
import { analysisQueue, scoringQueue } from '../queues';
import { LLMQueryJob } from '../types';
import { queryLLM, getProviderForModel } from '../services/llm/llm-router';
import { decryptSecret } from '../lib/crypto';

const log = childLogger({ worker: 'llm-query' });

export function createLLMQueryWorker(): Worker {
  return new Worker<LLMQueryJob>(
    'llm-query',
    async (job: Job<LLMQueryJob>) => {
      const { scan_id, brand_id, account_id, prompt_id, model, prompt_text, brand_name } = job.data;

      log.info({ job_id: job.id, scan_id, brand_id, prompt_id, model }, 'llm query start');

      let responseId: string | null = null;

      // Create a pending response record first
      const { data: responseRecord } = await supabase
        .from('responses')
        .insert({
          scan_id,
          brand_id,
          prompt_id,
          model,
          status: 'pending',
          queried_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      responseId = responseRecord?.id ?? null;

      try {
        // Resolve the account's BYO key for this model's provider.
        const provider = getProviderForModel(model);
        if (!provider) throw new Error(`No provider configured for model: ${model}`);

        const { data: keyRow } = await supabase
          .from('provider_keys')
          .select('ciphertext, iv, auth_tag')
          .eq('account_id', account_id)
          .eq('provider', provider)
          .single();

        if (!keyRow) {
          // Missing key → fail this model's response gracefully (no retry).
          const reason = `No ${provider} API key configured`;
          log.warn({ scan_id, brand_id, model, provider }, reason.toLowerCase());
          await supabase
            .from('responses')
            .update({ status: 'failed', snippet: reason })
            .eq('id', responseId);
        } else {
          const apiKey = decryptSecret({
            ciphertext: keyRow.ciphertext,
            iv: keyRow.iv,
            authTag: keyRow.auth_tag,
          });

          const llmResult = await queryLLM(model, prompt_text, apiKey);
          const snippet = llmResult.raw.slice(0, 300);

          await supabase
            .from('responses')
            .update({
              status: 'success',
              raw_response: llmResult.raw,
              snippet,
            })
            .eq('id', responseId);

          if (responseId) {
            await analysisQueue.add('analyse', {
              response_id: responseId,
              brand_id,
              brand_name,
              competitor_names: [], // Will be loaded by analysis worker
              api_citations: llmResult.citations,
            });
          }
        }
      } catch (err) {
        log.error({ err, scan_id, brand_id, prompt_id, model, response_id: responseId }, 'llm query failed');
        if (responseId) {
          await supabase
            .from('responses')
            .update({ status: 'failed' })
            .eq('id', responseId);
        }
      } finally {
        // Derive progress from committed rows rather than a read-modify-write
        // counter — the worker runs concurrently, so `completed_tasks + 1` would
        // race and lose increments, stranding the scan in `running` forever.
        // This job's response is terminal (success/failed) by now, so it counts.
        const { count } = await supabase
          .from('responses')
          .select('id', { count: 'exact', head: true })
          .eq('scan_id', scan_id)
          .neq('status', 'pending');
        const completed = count ?? 0;

        const { data: scan } = await supabase
          .from('scans')
          .select('total_tasks, status')
          .eq('id', scan_id)
          .single();

        if (scan) {
          if (completed >= scan.total_tasks) {
            // Atomically claim the terminal transition so exactly one job flips
            // the scan to `completed` and enqueues scoring.
            const { data: flipped } = await supabase
              .from('scans')
              .update({
                completed_tasks: completed,
                status: 'completed',
                completed_at: new Date().toISOString(),
              })
              .eq('id', scan_id)
              .neq('status', 'completed')
              .select('id');

            if (flipped && flipped.length > 0) {
              await scoringQueue.add('score', { scan_id, brand_id });
              log.info({ scan_id, brand_id }, 'scan complete, scoring enqueued');
            }
          } else {
            await supabase
              .from('scans')
              .update({ completed_tasks: completed })
              .eq('id', scan_id);
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

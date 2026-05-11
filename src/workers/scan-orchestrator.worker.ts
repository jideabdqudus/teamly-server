import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { supabase } from '../config/supabase';
import { childLogger } from '../config/logger';
import { llmQueryQueue, scanOrchestrateQueue } from '../queues';
import { ScanOrchestrateJob, ModelName } from '../types';
import { getSupportedModels } from '../services/llm/llm-router';
import { getAllowedModelCount } from '../lib/plan-limits';

const log = childLogger({ worker: 'scan-orchestrator' });

export function createScanOrchestratorWorker(): Worker {
  return new Worker<ScanOrchestrateJob>(
    'scan-orchestrate',
    async (job: Job<ScanOrchestrateJob>) => {
      const { org_id, triggered_by, prompt_ids, model_ids } = job.data;
      const scan_id = job.data.scan_id!;

      log.info({ job_id: job.id, scan_id, org_id, triggered_by }, 'scan orchestrate start');

      // Handle daily cron: iterate all active orgs
      if (triggered_by === 'cron' && !org_id) {
        const { data: orgs } = await supabase
          .from('organizations')
          .select('id, plan_tier');

        for (const org of orgs ?? []) {
          // Create a new scan for each org
          const { data: newScan } = await supabase
            .from('scans')
            .insert({ org_id: org.id, triggered_by: 'cron', status: 'pending' })
            .select()
            .single();

          if (newScan) {
            await scanOrchestrateQueue.add('orchestrate', {
              org_id: org.id,
              scan_id: newScan.id,
              triggered_by: 'cron',
            });
          }
        }
        return;
      }

      // Load org info for plan limits and brand name
      const { data: org } = await supabase
        .from('organizations')
        .select('brand_name, plan_tier, enabled_models')
        .eq('id', org_id)
        .single();

      if (!org) throw new Error(`Org ${org_id} not found`);

      // Determine which prompts to query
      let promptsQuery = supabase
        .from('prompts')
        .select('id, text')
        .eq('org_id', org_id)
        .eq('active', true);

      if (prompt_ids && prompt_ids.length > 0) {
        promptsQuery = promptsQuery.in('id', prompt_ids);
      }

      const { data: prompts } = await promptsQuery;
      if (!prompts || prompts.length === 0) {
        log.warn({ scan_id, org_id }, 'no active prompts for org — scan completed empty');
        await supabase.from('scans').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', scan_id);
        return;
      }

      // Determine which models to use
      const supportedModels = getSupportedModels();
      const allowedModelCount = getAllowedModelCount(org.plan_tier);

      let modelsToUse: ModelName[];
      if (model_ids && model_ids.length > 0) {
        modelsToUse = (model_ids as ModelName[]).filter((m) => supportedModels.includes(m));
      } else {
        modelsToUse = (org.enabled_models as ModelName[])
          .filter((m) => supportedModels.includes(m))
          .slice(0, allowedModelCount);
      }

      if (modelsToUse.length === 0) modelsToUse = ['ChatGPT'];

      const totalTasks = prompts.length * modelsToUse.length;

      // Update scan to running
      await supabase
        .from('scans')
        .update({ status: 'running', total_tasks: totalTasks, started_at: new Date().toISOString() })
        .eq('id', scan_id);

      // Enqueue one LLM query job per (prompt × model)
      const jobs = prompts.flatMap((p) =>
        modelsToUse.map((model) => ({
          name: 'query',
          data: {
            scan_id,
            org_id,
            prompt_id: p.id,
            model,
            prompt_text: p.text,
            brand_name: org.brand_name,
          },
        })),
      );

      await llmQueryQueue.addBulk(jobs);
      log.info(
        { scan_id, org_id, total_tasks: totalTasks, models: modelsToUse },
        'llm query jobs enqueued',
      );
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );
}

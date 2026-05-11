import { Worker, Job } from 'bullmq';
import { redis } from '../config/redis';
import { supabase } from '../config/supabase';
import { childLogger } from '../config/logger';
import { AnalysisJob } from '../types';
import { extractMentions } from '../services/analysis/mention-extractor';
import { analyzeSentiment } from '../services/analysis/sentiment-analyzer';
import { extractCitations } from '../services/analysis/citation-extractor';
import { classifyPosition } from '../services/analysis/position-classifier';

const log = childLogger({ worker: 'analysis' });

export function createAnalysisWorker(): Worker {
  return new Worker<AnalysisJob>(
    'analysis',
    async (job: Job<AnalysisJob>) => {
      const { response_id, org_id, brand_name, api_citations } = job.data;

      // Load the response from DB
      const { data: response } = await supabase
        .from('responses')
        .select('raw_response, prompt_id, model, scan_id')
        .eq('id', response_id)
        .single();

      if (!response || !response.raw_response) {
        log.warn({ response_id }, 'response has no raw text — skipping');
        return;
      }

      // Load competitor names for this org
      const { data: competitors } = await supabase
        .from('competitors')
        .select('name')
        .eq('org_id', org_id);

      const competitorNames = (competitors ?? []).map((c) => c.name);
      const rawText = response.raw_response;

      // 1. Extract mentions
      const mentions = extractMentions(rawText, brand_name, competitorNames);

      if (mentions.length > 0) {
        await supabase.from('mentions').insert(
          mentions.map((m) => ({
            response_id,
            org_id,
            name: m.name,
            type: m.type,
            position: m.position,
          })),
        );
      }

      // 2. Analyse sentiment
      const sentiment = analyzeSentiment(rawText, brand_name);
      const brandMentioned = mentions.some((m) => m.type === 'brand');

      // 3. Classify mention position
      const { label: _positionLabel, position } = classifyPosition(brand_name, mentions);

      // 4. Update response record
      await supabase
        .from('responses')
        .update({
          brand_mentioned: brandMentioned,
          brand_sentiment: brandMentioned ? sentiment : null,
          mention_position: position,
        })
        .eq('id', response_id);

      // 5. Extract and upsert citations
      const citations = extractCitations(rawText, api_citations);
      if (citations.length > 0) {
        for (const citation of citations) {
          // Upsert: update last_seen_at if URL already exists for this org
          const { data: existing } = await supabase
            .from('citations')
            .select('id')
            .eq('org_id', org_id)
            .eq('url', citation.url)
            .single();

          if (existing) {
            await supabase
              .from('citations')
              .update({ last_seen_at: new Date().toISOString() })
              .eq('id', existing.id);
          } else {
            await supabase.from('citations').insert({
              response_id,
              org_id,
              prompt_id: response.prompt_id,
              url: citation.url,
              domain: citation.domain,
              model: response.model,
              first_seen_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            });
          }
        }
      }

      log.info(
        {
          response_id,
          org_id,
          brand_mentioned: brandMentioned,
          sentiment,
          citation_count: citations.length,
        },
        'analysis complete',
      );
    },
    {
      connection: redis,
      concurrency: 20,
    },
  );
}

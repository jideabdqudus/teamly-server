import { BrandSentiment } from '../../types';

const POSITIVE_KEYWORDS = new Set([
  'best', 'leading', 'recommended', 'top', 'excellent', 'outstanding',
  'great', 'loved', 'popular', 'trusted', 'preferred', 'award',
  'innovative', 'powerful', 'reliable', 'easy', 'affordable',
]);

const NEGATIVE_KEYWORDS = new Set([
  'avoid', 'poor', 'problem', 'issue', 'worst', 'bad', 'disappointing',
  'failed', 'broken', 'expensive', 'limited', 'buggy', 'unreliable',
  'difficult', 'confusing', 'lacking', 'weak', 'outdated', 'scam',
]);

export interface SentimentResult {
  /** 0–100, where 50 is neutral. */
  score: number;
  label: Exclude<BrandSentiment, null>;
}

/** Score bands → coarse label, so the label always agrees with the score. */
function labelFor(score: number): SentimentResult['label'] {
  if (score >= 60) return 'positive';
  if (score <= 40) return 'negative';
  return 'neutral';
}

/**
 * Keyword-based sentiment scorer. Extracts sentences mentioning the brand and
 * grades them on a 0–100 scale (50 = neutral) from the balance of positive vs
 * negative keywords. This is the cheap, always-available baseline; an LLM-scored
 * analyzer can layer on top later and fall back here on failure.
 */
export function analyzeSentiment(
  text: string,
  brandName: string,
): SentimentResult {
  const brandRegex = new RegExp(`\\b${brandName}\\b`, 'gi');

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const relevantSentences = sentences.filter((s) => brandRegex.test(s));

  if (relevantSentences.length === 0) return { score: 50, label: 'neutral' };

  let positiveScore = 0;
  let negativeScore = 0;

  for (const sentence of relevantSentences) {
    for (const word of sentence.toLowerCase().split(/\W+/)) {
      if (POSITIVE_KEYWORDS.has(word)) positiveScore++;
      if (NEGATIVE_KEYWORDS.has(word)) negativeScore++;
    }
  }

  // Center at 50; each net keyword shifts the score by 15 points, clamped 0–100.
  const net = positiveScore - negativeScore;
  const score = Math.max(0, Math.min(100, Math.round(50 + net * 15)));

  return { score, label: labelFor(score) };
}

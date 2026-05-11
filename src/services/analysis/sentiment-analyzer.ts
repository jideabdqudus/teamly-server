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

/**
 * Keyword-based sentiment classifier.
 * Extracts sentences mentioning the brand and classifies sentiment.
 */
export function analyzeSentiment(text: string, brandName: string): BrandSentiment {
  const brandRegex = new RegExp(`\\b${brandName}\\b`, 'gi');

  // Split into sentences
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  // Only analyse sentences that mention the brand
  const relevantSentences = sentences.filter((s) => brandRegex.test(s));

  if (relevantSentences.length === 0) return 'neutral';

  let positiveScore = 0;
  let negativeScore = 0;

  for (const sentence of relevantSentences) {
    const words = sentence.toLowerCase().split(/\W+/);
    for (const word of words) {
      if (POSITIVE_KEYWORDS.has(word)) positiveScore++;
      if (NEGATIVE_KEYWORDS.has(word)) negativeScore++;
    }
  }

  if (positiveScore > negativeScore) return 'positive';
  if (negativeScore > positiveScore) return 'negative';
  return 'neutral';
}

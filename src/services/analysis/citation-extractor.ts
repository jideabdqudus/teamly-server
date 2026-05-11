import { extractDomain, normalizeUrl } from '../../lib/url-utils';

export interface CitationResult {
  url: string;
  domain: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

/**
 * Extracts and normalizes citations from an LLM response.
 * Prefers API-provided citations (e.g., from Perplexity or SerpAPI),
 * falling back to URL regex extraction from the raw text.
 */
export function extractCitations(
  text: string,
  apiCitations?: string[],
): CitationResult[] {
  const rawUrls: string[] = apiCitations && apiCitations.length > 0
    ? apiCitations
    : (text.match(URL_REGEX) ?? []);

  // Deduplicate and normalize
  const unique = [...new Set(rawUrls.map((u) => u.trim()))];

  return unique.map((url) => ({
    url: normalizeUrl(url),
    domain: extractDomain(url),
  })).filter((c) => c.domain.length > 0);
}

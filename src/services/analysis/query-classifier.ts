export type QueryType = 'brand' | 'generic' | 'competitor';

/**
 * Cheap heuristic classifier: a prompt that names the brand is `brand`, one that
 * names a competitor is `competitor`, otherwise `generic`. Brand wins over
 * competitor when both appear.
 */
export function classifyQueryType(
  text: string,
  brandName: string,
  competitorNames: string[],
): QueryType {
  const lower = text.toLowerCase();

  const brand = brandName.trim().toLowerCase();
  if (brand && lower.includes(brand)) return 'brand';

  for (const competitor of competitorNames) {
    const name = competitor.trim().toLowerCase();
    if (name && lower.includes(name)) return 'competitor';
  }

  return 'generic';
}

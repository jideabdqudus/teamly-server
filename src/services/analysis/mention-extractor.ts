export interface MentionResult {
  name: string;
  type: 'brand' | 'competitor';
  position: number;
  segment: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts brand and competitor mentions from an LLM response text.
 * Returns each mention with its ordinal position.
 */
export function extractMentions(
  text: string,
  brandName: string,
  competitorNames: string[],
): MentionResult[] {
  const results: MentionResult[] = [];
  const allEntities = [
    { name: brandName, type: 'brand' as const },
    ...competitorNames.map((n) => ({ name: n, type: 'competitor' as const })),
  ];

  // Split into paragraphs/list items for positional context
  const segments = text.split(/\n+/).filter((s) => s.trim().length > 0);

  let positionCounter = 0;
  const seen = new Set<string>(); // Deduplicate per segment

  for (const segment of segments) {
    for (const { name, type } of allEntities) {
      const key = `${segment}-${name}`;
      if (seen.has(key)) continue;

      const regex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'gi');
      if (regex.test(segment)) {
        positionCounter++;
        seen.add(key);
        results.push({ name, type, position: positionCounter, segment });
      }
    }
  }

  return results;
}

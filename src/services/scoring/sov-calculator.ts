export interface SovResult {
  name: string;
  type: 'brand' | 'competitor';
  mentions: number;
  shareOfVoice: number; // 0–100
}

interface MentionRecord {
  name: string;
  type: 'brand' | 'competitor';
}

/**
 * Calculates share of voice (SOV) for the brand and all competitors.
 * SOV = entity_mentions / total_all_mentions * 100
 */
export function calculateSOV(mentions: MentionRecord[]): SovResult[] {
  if (mentions.length === 0) return [];

  const counts = new Map<string, { type: 'brand' | 'competitor'; count: number }>();

  for (const m of mentions) {
    const key = m.name.toLowerCase();
    const existing = counts.get(key) ?? { type: m.type, count: 0 };
    existing.count++;
    counts.set(key, existing);
  }

  const total = mentions.length;

  return Array.from(counts.entries())
    .map(([name, { type, count }]) => ({
      name,
      type,
      mentions: count,
      shareOfVoice: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.mentions - a.mentions);
}

/**
 * Determines which competitors overtook the brand since the last scan.
 * Returns competitor names that now have higher SOV than the brand.
 */
export function detectOvertakes(
  currentSov: SovResult[],
  previousSov: SovResult[],
  brandName: string,
): string[] {
  const brandCurrentSov = currentSov.find(
    (s) => s.type === 'brand' && s.name.toLowerCase() === brandName.toLowerCase(),
  )?.shareOfVoice ?? 0;

  const brandPrevSov = previousSov.find(
    (s) => s.type === 'brand' && s.name.toLowerCase() === brandName.toLowerCase(),
  )?.shareOfVoice ?? 0;

  const overtakes: string[] = [];

  for (const curr of currentSov.filter((s) => s.type === 'competitor')) {
    const prev = previousSov.find(
      (s) => s.name.toLowerCase() === curr.name.toLowerCase(),
    );
    const prevSov = prev?.shareOfVoice ?? 0;

    // Overtook if: now higher than brand AND wasn't before
    if (curr.shareOfVoice > brandCurrentSov && prevSov <= brandPrevSov) {
      overtakes.push(curr.name);
    }
  }

  return overtakes;
}

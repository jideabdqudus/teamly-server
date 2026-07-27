export interface SovResult {
  name: string;
  type: 'brand' | 'competitor';
  mentions: number;
  shareOfVoice: number; // 0–100
  avgPosition: number | null; // mean rank across mentions, rounded to 1dp
}

interface MentionRecord {
  name: string;
  type: 'brand' | 'competitor';
  position?: number | null;
}

/**
 * Calculates share of voice (SOV) and average mention position for the brand and
 * all competitors. SOV = entity_mentions / total_all_mentions * 100.
 */
export function calculateSOV(mentions: MentionRecord[]): SovResult[] {
  if (mentions.length === 0) return [];

  const stats = new Map<
    string,
    { type: 'brand' | 'competitor'; count: number; positions: number[] }
  >();

  for (const m of mentions) {
    const key = m.name.toLowerCase();
    const existing = stats.get(key) ?? { type: m.type, count: 0, positions: [] };
    existing.count++;
    if (typeof m.position === 'number') existing.positions.push(m.position);
    stats.set(key, existing);
  }

  const total = mentions.length;

  return Array.from(stats.entries())
    .map(([name, { type, count, positions }]) => ({
      name,
      type,
      mentions: count,
      shareOfVoice: total > 0 ? Math.round((count / total) * 100) : 0,
      avgPosition:
        positions.length > 0
          ? Math.round(
              (positions.reduce((a, b) => a + b, 0) / positions.length) * 10,
            ) / 10
          : null,
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

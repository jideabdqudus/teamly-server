export interface SeriesPoint {
  date: string;
  value: number;
}

export interface Delta {
  value: number; // latest value in the series (0 if empty)
  change: number | null; // latest − previous; null with < 2 points
  change_pct: number | null; // percentage change, rounded; null if no baseline
  trend: SeriesPoint[]; // the series, oldest → newest
}

export function computeDelta(
  series: { date: string; value: number | null }[],
): Delta {
  const trend = series.filter(
    (p): p is SeriesPoint => typeof p.value === "number",
  );
  const current = trend.length > 0 ? trend[trend.length - 1].value : 0;

  if (trend.length < 2) {
    return { value: current, change: null, change_pct: null, trend };
  }

  const previous = trend[trend.length - 2].value;
  const change = current - previous;
  const change_pct =
    previous !== 0 ? Math.round((change / Math.abs(previous)) * 100) : null;

  return { value: current, change, change_pct, trend };
}

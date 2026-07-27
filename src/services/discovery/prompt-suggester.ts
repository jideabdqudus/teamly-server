import { classifyQueryType, QueryType } from "../analysis/query-classifier";

export interface SuggestionSeed {
  brandName: string;
  industry: string | null;
  competitorNames: string[];
}

export interface GeneratedSuggestion {
  text: string;
  queryType: QueryType;
  source: "llm" | "template";
}

export type QueryFn = (prompt: string) => Promise<string>;

function buildPrompt(seed: SuggestionSeed): string {
  return [
    "You help a brand monitor how it shows up in AI search.",
    `Brand: ${seed.brandName}`,
    `Industry: ${seed.industry ?? "unknown"}`,
    `Competitors: ${seed.competitorNames.join(", ") || "none"}`,
    "",
    "List 8 realistic questions a buyer might ask an AI assistant when researching",
    "this category or comparing options. Mix generic category questions,",
    "brand-specific questions, and competitor comparisons.",
    "Return ONLY a JSON array of question strings.",
  ].join("\n");
}

function parseSuggestionList(raw: string): string[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter((t): t is string => typeof t === "string");
      }
    } catch {
      // fall through to line parsing below
    }
  }

  return raw
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*\d.)]+)\s*/, "")
        .replace(/^["']|["']$/g, "")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

function templateSuggestions(seed: SuggestionSeed): string[] {
  const industry = seed.industry?.trim() || "this category";
  const templates = [
    `What is the best ${industry} tool?`,
    `Best alternatives to ${seed.brandName}`,
    `Is ${seed.brandName} worth it?`,
    `What do people say about ${seed.brandName}?`,
    `Top ${industry} companies in ${new Date().getFullYear()}`,
    `${seed.brandName} pricing and reviews`,
  ];
  const [firstCompetitor] = seed.competitorNames;
  if (firstCompetitor) {
    templates.push(`${seed.brandName} vs ${firstCompetitor}`);
  }
  return templates;
}

export async function generateSuggestions(
  seed: SuggestionSeed,
  queryFn?: QueryFn,
): Promise<GeneratedSuggestion[]> {
  let texts: string[] = [];
  let source: GeneratedSuggestion["source"] = "template";

  if (queryFn) {
    try {
      const parsed = parseSuggestionList(await queryFn(buildPrompt(seed)));
      if (parsed.length > 0) {
        texts = parsed;
        source = "llm";
      }
    } catch {
      // fall back to templates below
    }
  }

  if (texts.length === 0) texts = templateSuggestions(seed);

  // De-dupe (case-insensitive), trim, and cap.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of texts) {
    const text = raw.trim();
    const key = text.toLowerCase();
    if (text.length >= 5 && text.length <= 500 && !seen.has(key)) {
      seen.add(key);
      unique.push(text);
    }
  }

  return unique.slice(0, 12).map((text) => ({
    text,
    queryType: classifyQueryType(text, seed.brandName, seed.competitorNames),
    source,
  }));
}

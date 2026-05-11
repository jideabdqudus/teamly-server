import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { parse } from 'yaml';

let cached: Record<string, unknown> | null = null;

function resolveOpenApiYamlPath(): string {
  const candidates = [
    path.join(__dirname, '..', 'openapi', 'openapi.yaml'),
    path.join(__dirname, '..', '..', 'openapi', 'openapi.yaml'),
    path.join(process.cwd(), 'openapi', 'openapi.yaml'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`OpenAPI spec not found. Tried:\n${candidates.join('\n')}`);
}

export function getOpenApiSpec(): Record<string, unknown> {
  if (!cached) {
    const raw = readFileSync(resolveOpenApiYamlPath(), 'utf8');
    cached = parse(raw) as Record<string, unknown>;
  }
  return cached;
}

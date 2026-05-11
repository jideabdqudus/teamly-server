/**
 * Extracts the root domain from a URL, stripping www. prefix.
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Normalizes a URL: strips trailing slashes and fragments.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

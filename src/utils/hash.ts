import { createHash } from 'crypto';

/**
 * Creates a deterministic SHA-256 hash for a highlight to guarantee deduplication.
 */
export function generateHighlightHash(asinOrTitle: string, location: string | undefined, text: string): string {
  const normalizedText = (text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normalizedLocation = (location || '').trim().toLowerCase();
  const normalizedKey = (asinOrTitle || '').trim().toLowerCase();
  const rawKey = `${normalizedKey}_${normalizedLocation}_${normalizedText}`;
  return createHash('sha256').update(rawKey).digest('hex').substring(0, 32);
}

/**
 * Normalizes book title for fuzzy matching across Kindle and Goodreads.
 */
export function normalizeTitle(title: string): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[–—].*$/g, '')
    .replace(/:\s*.*$/g, '')
    .replace(/-\s*.*$/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

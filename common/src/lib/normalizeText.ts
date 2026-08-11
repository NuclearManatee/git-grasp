// @ts-nocheck
/** Browser-safe string normalizers (no Node / schema imports). */

export function normalizeExample(example: unknown): string {
  return String(example || '')
    .trim()
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ');
}

export function commandSlug(command: unknown): string {
  return String(command)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

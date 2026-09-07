export function normalizeText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = typeof value === 'string' ? value : String(value);
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

export function normalizeUnit(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized === null ? null : normalized;
}

export function isBlankValue(value: unknown): boolean {
  return normalizeText(value) === null;
}

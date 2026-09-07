export const ALLOWED_IMPORT_EXTENSIONS = ['.csv', '.xls', '.xlsx'] as const;

export function getNormalizedFileExtension(fileName: string): string {
  const trimmedName = (fileName ?? '').trim();
  if (!trimmedName) return '';

  const lastDot = trimmedName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === trimmedName.length - 1) {
    return '';
  }

  return trimmedName.slice(lastDot).toLowerCase();
}

export function isAllowedImportExtension(fileName: string): boolean {
  const extension = getNormalizedFileExtension(fileName);
  return ALLOWED_IMPORT_EXTENSIONS.includes(extension as (typeof ALLOWED_IMPORT_EXTENSIONS)[number]);
}

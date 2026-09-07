import { normalizeUnit } from './normalize';

export function normalizeQuantityUnit(value: unknown): string | null {
  return normalizeUnit(value);
}

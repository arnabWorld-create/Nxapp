import { normalizeText } from './normalize';

export type ParseNumericResult = {
  normalized: string;
  isNegative: boolean;
};

const currencyRegex = /\p{Sc}/gu;

function trimCurrency(value: string): string {
  return value.replace(currencyRegex, '').trim();
}

function normalizeIntegerPart(rawInteger: string): string {
  if (/^0+$/.test(rawInteger)) {
    return '0';
  }
  return rawInteger.replace(/^0+(?=\d)/, '');
}

export function normalizeNumericValue(value: unknown): ParseNumericResult | null {
  const raw = normalizeText(value);
  if (raw === null) {
    return null;
  }

  const cleaned = trimCurrency(raw).replace(/\s+/g, '');
  if (cleaned === '') {
    return null;
  }

  const match = cleaned.match(/^([+-]?)(?:(\d{1,3}(?:,\d{3})*)|(\d+))(?:\.(\d+))?$/);
  if (!match) {
    throw new Error('Invalid numeric value');
  }

  const sign = match[1] === '-' ? '-' : '';
  const integerPart = match[2] ?? match[3] ?? '0';
  const fractionPart = match[4];
  const integerDigits = integerPart.replace(/,/g, '');

  if (!/^\d+$/.test(integerDigits)) {
    throw new Error('Invalid numeric value');
  }

  const normalizedInteger = normalizeIntegerPart(integerDigits);
  const normalized = sign + normalizedInteger + (fractionPart ? `.${fractionPart}` : '');
  return {
    normalized,
    isNegative: sign === '-',
  };
}

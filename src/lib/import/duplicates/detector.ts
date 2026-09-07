import crypto from 'crypto';
import type { ValidatedRow } from '../validation';
import { normalizeHeader } from '../mapping/normalize-header';
import type { DuplicateResult, DuplicateDetectOptions } from './types';

const DEFAULT_THRESHOLD = 85;

const FIELD_ORDER: Array<keyof ValidatedRow['normalizedData'] | 'source_item_name'> = [
  'source_item_name',
  'reported_purchase_qty',
  'reported_purchase_value',
  'reported_sales_qty',
  'reported_sales_value',
  'reported_sales_return_qty',
  'reported_sales_return_value',
  'reported_purchase_return_qty',
  'reported_purchase_return_value',
  'reported_closing_stock_qty',
  'reported_closing_stock_value',
  'quantity_unit',
];

const WEIGHTS: Record<typeof FIELD_ORDER[number], number> = (() => {
  const w: Partial<Record<typeof FIELD_ORDER[number], number>> = {};
  // source_item_name heavier
  w['source_item_name'] = 0.4;
  // quantity_unit moderate
  w['quantity_unit'] = 0.1;
  // remaining numeric fields split 0.5 among 10 fields
  const remaining = 0.5;
  const numericFields = FIELD_ORDER.filter((f) => f !== 'source_item_name' && f !== 'quantity_unit');
  const per = remaining / numericFields.length;
  for (const f of numericFields) {
    w[f] = per;
  }
  return w as Record<typeof FIELD_ORDER[number], number>;
})();

function fingerprintForRow(row: ValidatedRow): string {
  const parts = FIELD_ORDER.map((field) => {
    if (field === 'source_item_name') {
      const v = row.normalizedData.source_item_name ?? '';
      return normalizeHeader(String(v));
    }
    const v = row.normalizedData[field];
    return v === null || v === undefined ? '' : String(v);
  });

  const hasNonEmpty = parts.some((p) => p !== '');
  if (!hasNonEmpty) {
    // For rows with no normalized data, avoid marking them as exact duplicates.
    // Use sourceRowNumber to keep fingerprint deterministic but unique per-row.
    return crypto.createHash('sha256').update(`EMPTY:${row.sourceRowNumber}`).digest('hex');
  }

  // Canonicalize numeric strings by removing trailing zeros in fractional part
  const canonicalParts = parts.map((part, idx) => {
    const field = FIELD_ORDER[idx];
    if (part === '') return '';
    if (field === 'source_item_name' || field === 'quantity_unit') return String(part);
    // numeric field; remove trailing zeros in fraction
    if (typeof part === 'string' && part.includes('.')) {
      let p = part.replace(/(\.\d*?)0+$/, '$1');
      if (p.endsWith('.')) p = p.slice(0, -1);
      return p;
    }
    return part;
  });

  const joined = canonicalParts.join('|');
  const hash = crypto.createHash('sha256').update(joined).digest('hex');
  return hash;
}

function equalsNormalized(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return false; // treat both null as no evidence
  if (a === null || b === null) return false;
  return a === b;
}

function compareRows(a: ValidatedRow, b: ValidatedRow) {
  // compute matches, diffs and score
  let scoreNumerator = 0;
  let scoreDenominator = 0;
  const matched: Array<typeof FIELD_ORDER[number]> = [];
  const diffs: Array<typeof FIELD_ORDER[number]> = [];

  for (const field of FIELD_ORDER) {
    const weight = WEIGHTS[field];
    const aVal = field === 'source_item_name' ? a.normalizedData.source_item_name ?? null : a.normalizedData[field as keyof ValidatedRow['normalizedData']];
    const bVal = field === 'source_item_name' ? b.normalizedData.source_item_name ?? null : b.normalizedData[field as keyof ValidatedRow['normalizedData']];

    // if both null/empty, skip from denominator
    if ((aVal === null || aVal === '') && (bVal === null || bVal === '')) {
      continue;
    }

    // field contributes to denominator
    scoreDenominator += weight;

    if (equalsNormalized(aVal as string | null, bVal as string | null)) {
      scoreNumerator += weight;
      matched.push(field);
    } else {
      // treat as difference
      diffs.push(field);
    }
  }

  const score = scoreDenominator === 0 ? 0 : Math.round((scoreNumerator / scoreDenominator) * 100);
  return { score, matchedFields: matched, differences: diffs };
}

export function detectDuplicates(rows: ValidatedRow[], options?: DuplicateDetectOptions): DuplicateResult[] {
  const threshold = options?.possibleThreshold ?? DEFAULT_THRESHOLD;
  // create shallow copies and compute fingerprints
  const entries = rows.map((r) => ({ row: r, fingerprint: fingerprintForRow(r) }));

  // blocking by normalized source_item_name
  const blocks: Record<string, Array<typeof entries[number]>> = {};
  for (const entry of entries) {
    const key = normalizeHeader(String(entry.row.normalizedData.source_item_name ?? ''));
    if (!blocks[key]) blocks[key] = [];
    blocks[key].push(entry);
  }

  const results: DuplicateResult[] = new Array(rows.length).fill(null).map(() => ({ status: 'NEW', matchedFields: [], differences: [] } as DuplicateResult));

  // For each block, compare entries
  for (const blockEntries of Object.values(blocks)) {
    // Source row number is the only source identity available at this stage.
    // Business-value equality alone is not evidence of a duplicate sale line.
    const sourceRowMap: Record<string, number> = {};

    for (let i = 0; i < blockEntries.length; i++) {
      const { row, fingerprint } = blockEntries[i];
      const globalIndex = rows.findIndex((r) => r === row);
      const sourceRowKey = String(row.sourceRowNumber);
      if (sourceRowMap[sourceRowKey] !== undefined) {
        // A repeated source row number is an actual source identity collision.
        const canonicalIdx = sourceRowMap[sourceRowKey]!;
        results[globalIndex] = {
          status: 'EXACT_DUPLICATE',
          fingerprint,
          matchedFields: compareRows(rows[canonicalIdx], row).matchedFields,
          differences: compareRows(rows[canonicalIdx], row).differences,
          duplicateOfRowNumber: rows[canonicalIdx].sourceRowNumber,
        };
      } else {
        sourceRowMap[sourceRowKey] = globalIndex;
        results[globalIndex] = { status: 'NEW', fingerprint, matchedFields: [], differences: [] };
      }
    }

    // Similarity between separate source rows is not duplicate evidence for
    // transactional sales data. POSSIBLE_DUPLICATE remains a supported status
    // for persisted/legacy results, but new rows are left independent here.
  }

  // Ensure results align with input order
  return results;
}

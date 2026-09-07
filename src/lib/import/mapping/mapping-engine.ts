import { canonicalFields, canonicalFieldLabels, aliasToFieldMap, canonicalFieldAliases } from './aliases';
import { normalizeHeader } from './normalize-header';
import type { CanonicalField, HeaderMappingResult, ImportMappingTemplate, MappingCandidate, MappingConfidence, MappingStatus } from './types';

const AMBIGUOUS_WEIGHT = 0.75;
const KNOWN_IGNORED_HEADERS = new Set([
  'opstk',
  'p sch',
  's sch',
  'crqty',
  'crschqty',
  'dbqty',
]);

const ambiguousFieldGroups: Record<string, CanonicalField[]> = {
  qty: [
    'reported_purchase_qty',
    'reported_sales_qty',
    'reported_sales_return_qty',
    'reported_purchase_return_qty',
    'reported_closing_stock_qty',
  ],
  quantity: [
    'reported_purchase_qty',
    'reported_sales_qty',
    'reported_sales_return_qty',
    'reported_purchase_return_qty',
    'reported_closing_stock_qty',
  ],
  value: [
    'reported_purchase_value',
    'reported_sales_value',
    'reported_sales_return_value',
    'reported_purchase_return_value',
    'reported_closing_stock_value',
  ],
  amount: [
    'reported_purchase_value',
    'reported_sales_value',
    'reported_sales_return_value',
    'reported_purchase_return_value',
    'reported_closing_stock_value',
  ],
};

function isAmbiguousHeader(normalizedHeader: string): boolean {
  return Object.keys(ambiguousFieldGroups).includes(normalizedHeader);
}

function buildAmbiguousCandidates(normalizedHeader: string): MappingCandidate[] {
  const fieldKeys = ambiguousFieldGroups[normalizedHeader] ?? [];
  return fieldKeys.map((targetField) => ({
    targetField,
    confidenceScore: 0.65,
    reason: 'Generic header that may map to multiple fields',
  }));
}

function buildCandidate(targetField: CanonicalField, score: number, reason: string): MappingCandidate {
  return {
    targetField,
    confidenceScore: Number(score.toFixed(2)),
    reason,
  };
}

function scoreSimilarity(source: string, comparison: string): number {
  if (!source || !comparison) {
    return 0;
  }

  if (source === comparison) {
    return 1;
  }

  if (source.includes(comparison) || comparison.includes(source)) {
    return 0.85;
  }

  const sourceWords = source.split(' ');
  const comparisonWords = comparison.split(' ');
  const commonWords = sourceWords.filter((word) => comparisonWords.includes(word));
  const overlap = commonWords.length / Math.max(sourceWords.length, comparisonWords.length);
  return overlap * 0.8;
}

function buildFuzzyCandidates(normalizedHeader: string): MappingCandidate[] {
  const scores: Map<CanonicalField, number> = new Map();

  for (const targetField of canonicalFields) {
    let topScore = scoreSimilarity(normalizedHeader, normalizeHeader(canonicalFieldLabels[targetField]));

    for (const alias of canonicalFieldAliases[targetField]) {
      topScore = Math.max(topScore, scoreSimilarity(normalizedHeader, normalizeHeader(alias)));
    }

    if (topScore > 0) {
      scores.set(targetField, topScore);
    }
  }

  return Array.from(scores.entries())
    .map(([targetField, score]) =>
      buildCandidate(targetField, score, 'Fuzzy similarity to known aliases and field label')
    )
    .filter((candidate) => candidate.confidenceScore >= 0.35)
    .sort((a, b) => b.confidenceScore - a.confidenceScore);
}

function getTemplateMatch(sourceHeader: string, template?: ImportMappingTemplate): CanonicalField | null {
  if (!template) {
    return null;
  }

  const normalizedSource = normalizeHeader(sourceHeader);
  for (const [templateHeader, field] of Object.entries(template.mapping)) {
    if (normalizeHeader(templateHeader) === normalizedSource) {
      return field;
    }
  }

  return null;
}

export function isValidCanonicalField(value: unknown): value is CanonicalField {
  return typeof value === 'string' && canonicalFields.includes(value as CanonicalField);
}

export function translateHeaderToField(sourceHeader: string, template?: ImportMappingTemplate, duplicate = false): HeaderMappingResult {
  const normalizedHeader = normalizeHeader(sourceHeader);
  const duplicateSourceHeader = duplicate;

  if (!sourceHeader.trim() || normalizedHeader === '') {
    return {
      sourceHeader,
      normalizedHeader,
      targetField: null,
      confidence: 'NONE',
      status: 'IGNORED',
      candidates: [],
      duplicateSourceHeader,
    };
  }

  if (KNOWN_IGNORED_HEADERS.has(normalizedHeader)) {
    return {
      sourceHeader,
      normalizedHeader,
      targetField: null,
      confidence: 'NONE',
      status: 'IGNORED',
      candidates: [],
      duplicateSourceHeader,
    };
  }

  const templateField = getTemplateMatch(sourceHeader, template);
  const aliasField = aliasToFieldMap[normalizedHeader] as CanonicalField | undefined;
  const exactCanonicalMatch = canonicalFields.includes(sourceHeader.trim() as CanonicalField)
    ? (sourceHeader.trim() as CanonicalField)
    : null;

  if (duplicateSourceHeader) {
    const candidates = aliasField
      ? [{
          targetField: aliasField,
          confidenceScore: 0.9,
          reason: 'Known alias for duplicated header; review required to avoid overwriting',
        }]
      : buildFuzzyCandidates(normalizedHeader);

    return {
      sourceHeader,
      normalizedHeader,
      targetField: null,
      confidence: 'NONE',
      status: 'REVIEW_REQUIRED',
      candidates,
      duplicateSourceHeader,
    };
  }

  if (exactCanonicalMatch) {
    return {
      sourceHeader,
      normalizedHeader,
      targetField: exactCanonicalMatch,
      confidence: 'HIGH',
      status: 'AUTO_MAPPED',
      candidates: [buildCandidate(exactCanonicalMatch, 1, 'Exact canonical field name match')],
      duplicateSourceHeader,
    };
  }

  if (templateField) {
    return {
      sourceHeader,
      normalizedHeader,
      targetField: templateField,
      confidence: 'HIGH',
      status: 'AUTO_MAPPED',
      candidates: [buildCandidate(templateField, 0.95, 'Mapping template exact match')],
      duplicateSourceHeader,
    };
  }

  if (aliasField) {
    return {
      sourceHeader,
      normalizedHeader,
      targetField: aliasField,
      confidence: 'HIGH',
      status: 'AUTO_MAPPED',
      candidates: [buildCandidate(aliasField, 1, 'Known alias match')],
      duplicateSourceHeader,
    };
  }

  if (isAmbiguousHeader(normalizedHeader)) {
    return {
      sourceHeader,
      normalizedHeader,
      targetField: null,
      confidence: 'NONE',
      status: 'REVIEW_REQUIRED',
      candidates: buildAmbiguousCandidates(normalizedHeader),
      duplicateSourceHeader,
    };
  }

  const fuzzyCandidates = buildFuzzyCandidates(normalizedHeader);
  if (fuzzyCandidates.length > 0) {
    return {
      sourceHeader,
      normalizedHeader,
      targetField: null,
      confidence: fuzzyCandidates[0].confidenceScore >= 0.75 ? 'MEDIUM' : 'LOW',
      status: 'SUGGESTED',
      candidates: fuzzyCandidates,
      duplicateSourceHeader,
    };
  }

  return {
    sourceHeader,
    normalizedHeader,
    targetField: null,
    confidence: 'NONE',
    status: 'UNMAPPED',
    candidates: [],
    duplicateSourceHeader,
  };
}

export function buildHeaderMappingResults(sourceHeaders: string[], template?: ImportMappingTemplate): HeaderMappingResult[] {
  const duplicates = sourceHeaders.reduce<Record<string, number>>((acc, header) => {
    const normalized = normalizeHeader(header);
    acc[normalized] = (acc[normalized] ?? 0) + 1;
    return acc;
  }, {});

  const results = sourceHeaders.map((header) =>
    translateHeaderToField(header, template, duplicates[normalizeHeader(header)] > 1)
  );

  // Some sales statements use a generic Qty/Taxable pair. Resolve that pair
  // only when the surrounding headers identify this specific sales layout.
  const normalizedHeaders = new Set(sourceHeaders.map(normalizeHeader));
  if (normalizedHeaders.has('qty') && normalizedHeaders.has('taxable') && normalizedHeaders.has('product na')) {
    for (const result of results) {
      if (result.normalizedHeader === 'qty' && result.targetField === null && result.status === 'REVIEW_REQUIRED') {
        result.targetField = 'reported_sales_qty';
        result.confidence = 'HIGH';
        result.status = 'AUTO_MAPPED';
        result.candidates = [{ targetField: 'reported_sales_qty', confidenceScore: 1, reason: 'Known sales-statement Qty/Taxable header combination' }];
      }
      if (result.normalizedHeader === 'taxable' && result.targetField === null && result.status === 'UNMAPPED') {
        result.targetField = 'reported_sales_value';
        result.confidence = 'HIGH';
        result.status = 'AUTO_MAPPED';
        result.candidates = [{ targetField: 'reported_sales_value', confidenceScore: 1, reason: 'Known sales-statement Qty/Taxable header combination' }];
      }
    }
  }

  return results;
}

export function applyMappingTemplate(sourceHeaders: string[], template: ImportMappingTemplate): HeaderMappingResult[] {
  return buildHeaderMappingResults(sourceHeaders, template);
}

export function validateTemplate(template: ImportMappingTemplate): boolean {
  if (!template || typeof template !== 'object') {
    return false;
  }
  if (typeof template.name !== 'string' || typeof template.fileType !== 'string') {
    return false;
  }
  if (typeof template.mapping !== 'object' || template.mapping === null) {
    return false;
  }
  return Object.values(template.mapping).every(isValidCanonicalField);
}

export function isTemplateMatchUseful(sourceHeaders: string[], template: ImportMappingTemplate): boolean {
  return sourceHeaders.some((sourceHeader) => {
    const normalizedHeader = normalizeHeader(sourceHeader);
    return Object.keys(template.mapping).some(
      (templateHeader) => normalizeHeader(templateHeader) === normalizedHeader
    );
  });
}

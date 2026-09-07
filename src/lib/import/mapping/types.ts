export type CanonicalField =
  | 'source_item_name'
  | 'reported_purchase_qty'
  | 'reported_purchase_value'
  | 'reported_sales_qty'
  | 'reported_sales_value'
  | 'reported_sales_return_qty'
  | 'reported_sales_return_value'
  | 'reported_purchase_return_qty'
  | 'reported_purchase_return_value'
  | 'reported_closing_stock_qty'
  | 'reported_closing_stock_value'
  | 'quantity_unit';

export type MappingConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export type MappingStatus = 'AUTO_MAPPED' | 'SUGGESTED' | 'REVIEW_REQUIRED' | 'UNMAPPED' | 'IGNORED';

export type MappingCandidate = {
  targetField: CanonicalField;
  confidenceScore: number;
  reason: string;
};

export type HeaderMappingResult = {
  sourceHeader: string;
  normalizedHeader: string;
  targetField: CanonicalField | null;
  confidence: MappingConfidence;
  status: MappingStatus;
  candidates: MappingCandidate[];
  duplicateSourceHeader?: boolean;
};

export type ImportMappingTemplate = {
  name: string;
  fileType: string;
  mapping: Record<string, CanonicalField>;
};

export const REQUIRED_CANONICAL_FIELDS: CanonicalField[] = ['source_item_name'];

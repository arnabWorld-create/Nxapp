import type { CanonicalField } from '../mapping';

export type ValidationSeverity = 'ERROR' | 'WARNING';
export type ValidationStatus = 'PENDING' | 'VALID' | 'INVALID' | 'REVIEW_REQUIRED';

export type ValidationIssueCode =
  | 'SOURCE_ITEM_NAME_REQUIRED'
  | 'INVALID_NUMERIC'
  | 'INVALID_QUANTITY'
  | 'INVALID_VALUE'
  | 'MISSING_QUANTITY_UNIT'
  | 'NEGATIVE_QUANTITY'
  | 'NEGATIVE_VALUE'
  | 'UNKNOWN_FIELD'
  | 'MAPPING_REQUIRED';

export type ValidationIssue = {
  code: ValidationIssueCode;
  field: CanonicalField | 'source_item_name' | 'quantity_unit' | 'unknown_field';
  sourceHeader: string;
  sourceValue: unknown;
  severity: ValidationSeverity;
  message: string;
};

export type NormalizedRowData = {
  source_item_name: string | null;
  reported_purchase_qty: string | null;
  reported_purchase_value: string | null;
  reported_sales_qty: string | null;
  reported_sales_value: string | null;
  reported_sales_return_qty: string | null;
  reported_sales_return_value: string | null;
  reported_purchase_return_qty: string | null;
  reported_purchase_return_value: string | null;
  reported_closing_stock_qty: string | null;
  reported_closing_stock_value: string | null;
  quantity_unit: string | null;
};

export type ValidatedRow = {
  sourceRowNumber: number;
  rawData: Record<string, unknown>;
  normalizedData: NormalizedRowData;
  validationStatus: ValidationStatus;
  issues: ValidationIssue[];
};

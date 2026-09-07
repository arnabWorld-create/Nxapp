import type { ValidationStatus } from './validation';
import type { DuplicateStatus } from './duplicates';
import type { MatchStatus, ConfidenceLevel } from '../matching/types';

export interface ReviewRequestQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  validationStatus?: ValidationStatus;
  duplicateStatus?: DuplicateStatus;
  mappingStatus?: MatchStatus;
  rowType?: 'DATA_ROW' | 'SUMMARY_ROW' | 'NON_DATA_ROW';
}

export interface ReviewRow {
  id: string;
  sourceRowNumber: number | null;
  sourceItemName: string | null;
  normalizedSourceItemName: string | null;
  reportedPurchaseQty: string | null;
  reportedPurchaseValue: string | null;
  reportedSalesQty: string | null;
  reportedSalesValue: string | null;
  reportedClosingStockQty: string | null;
  reportedClosingStockValue: string | null;
  quantityUnit: string | null;
  sourceQuantityUnit: string | null;
  quantityUnitResolution: 'EXPLICIT_SOURCE' | 'FILE_DEFAULT' | 'UNRESOLVED';
  validationStatus: ValidationStatus;
  duplicateStatus: DuplicateStatus;
  mappingStatus: MatchStatus;
  mappingLabel?: 'AUTO MATCHED' | 'PREVIOUSLY CONFIRMED' | 'IGNORED / EXCLUDED';
  rowType: 'DATA_ROW' | 'SUMMARY_ROW' | 'NON_DATA_ROW';
  nonDataReason: string | null;
  confirmedBrand: { id: string; name: string } | null;
  confirmedProduct: { id: string; name: string } | null;
  confirmedVariant: { id: string; name: string } | null;
  suggestedBrand: { id: string; name: string } | null;
  suggestedProduct: { id: string; name: string } | null;
  suggestedVariant: { id: string; name: string } | null;
  mappingConfidence?: ConfidenceLevel;
  suggestedMatch?: {
    entityType: 'BRAND' | 'PRODUCT' | 'VARIANT';
    entityId: string;
    entityName: string;
    score: number;
    confidence: ConfidenceLevel;
  };
  confirmedMatch?: {
    entityType: 'BRAND' | 'PRODUCT' | 'VARIANT';
    entityId: string;
    entityName: string;
    confirmedAt: string;
    confirmedBy: string | null;
    reason: string | null;
  };
  rawData: Record<string, unknown>;
  normalizedData: any;
  validationIssues: any;
  duplicateResult?: any;
}

export interface ReviewSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  reviewRequiredRows: number;
  exactDuplicates: number;
  possibleDuplicates: number;
  unmatchedRows: number;
  suggestedRows: number;
  confirmedRows: number;
  rejectedRows: number;
  summaryRows: number;
  nonDataRows: number;
  dataRowsMissingQuantityUnit: number;
}

export interface ReviewResponse {
  import: {
    id: string;
    fileName: string;
    fileType: string;
    status: string;
    createdAt: string;
    uploadedBy: string | null;
    defaultQuantityUnit: string | null;
    defaultQuantityUnitConfirmed: boolean;
    defaultQuantityUnitConfirmedBy: string | null;
    defaultQuantityUnitConfirmedAt: string | null;
    summaryRowsAcknowledged: boolean;
    summaryRowsAcknowledgedBy: string | null;
    summaryRowsAcknowledgedAt: string | null;
  };
  summary: ReviewSummary;
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalRows: number;
  };
  rows: ReviewRow[];
}

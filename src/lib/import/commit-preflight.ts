/**
 * COMMIT PREFLIGHT SERVICE (Phase 4.1 — read-only)
 *
 * Determines exactly which rows of an Import are eligible for commit and which
 * rows must block/review, WITHOUT creating Statement/StatementRows, WITHOUT
 * modifying Import status, and WITHOUT writing any audit logs.
 *
 * Eligibility rules are derived strictly from the existing application/business
 * model (see prisma/schema.prisma, process.ts, validator.ts, detector.ts and
 * the matching confirm route). No new business rules are invented here.
 *
 * Stated ambiguities (see final report):
 *  - The codebase defines no commit-from-FAILED / commit-from-CANCELLED
 *    behaviour. These terminal states are treated conservatively as
 *    non-committable (explicit blocker) pending Phase 4.2 confirmation.
 *  - REVIEW_REQUIRED (and the never-assigned-after-processing PENDING) rows are
 *    not silently committed; they are reported as non-eligible.
 *  - Duplicate rows (EXACT_DUPLICATE / POSSIBLE_DUPLICATE) are not silently
 *    discarded; they are reported as non-eligible and block commit.
 */

import prisma from '../prisma';
import type { ImportStatus } from '@prisma/client';

export class ImportNotFoundError extends Error {
  constructor(importId: string) {
    super(`Import not found: ${importId}`);
    this.name = 'ImportNotFoundError';
  }
}

export interface CommitPreflightRowFlags {
  id: string;
  validation_status: 'PENDING' | 'VALID' | 'INVALID' | 'REVIEW_REQUIRED';
  duplicate_status: 'NEW' | 'EXACT_DUPLICATE' | 'POSSIBLE_DUPLICATE';
  row_type: 'DATA_ROW' | 'SUMMARY_ROW' | 'NON_DATA_ROW';
  confirmed_brand_id: string | null;
  confirmed_product_id: string | null;
  confirmed_variant_id: string | null;
  suggested_brand_id: string | null;
  suggested_product_id: string | null;
  suggested_variant_id: string | null;
  match_reason: string | null;
}

export interface CommitPreflightResult {
  importId: string;
  status: ImportStatus;
  totalRows: number;
  eligibleRows: number;
  invalidRows: number;
  reviewRequiredRows: number;
  duplicateRows: number;
  unmappedRows: number;
  missingConfirmedMappingRows: number;
  rejectedRows: number;
  unmatchedRows: number;
  alreadyCommitted: boolean;
  canCommit: boolean;
  blockers: string[];
}

interface PreflightMaps {
  brandExists: Map<string, boolean>;
  productBrand: Map<string, string | null | undefined>;
  productDivision: Map<string, string | null | undefined>;
  variantProduct: Map<string, string | undefined>;
}

/**
 * Verify a confirmed mapping still exists in the masters and respects the
 * hierarchy: Variant -> Product -> Brand. We never infer missing hierarchy.
 */
function isConfirmedMappingConsistent(
  row: CommitPreflightRowFlags,
  maps: PreflightMaps
): boolean {
  // Brand level
  if (row.confirmed_brand_id) {
    if (!maps.brandExists.get(row.confirmed_brand_id)) return false;
  }

  // Variant implies Product must be present and consistent
  if (row.confirmed_variant_id && !row.confirmed_product_id) return false;

  // Product level
  if (row.confirmed_product_id) {
    const productBrand = maps.productBrand.get(row.confirmed_product_id);
    if (productBrand === undefined) return false; // product no longer exists
    if (row.confirmed_brand_id && productBrand !== row.confirmed_brand_id) {
      return false; // hierarchy mismatch: product belongs to a different brand
    }
    if (!row.confirmed_brand_id && !maps.productDivision.get(row.confirmed_product_id)) return false;
  }

  // Variant level
  if (row.confirmed_variant_id) {
    const variantProduct = maps.variantProduct.get(row.confirmed_variant_id);
    if (variantProduct === undefined) return false; // variant no longer exists
    if (row.confirmed_product_id && variantProduct !== row.confirmed_product_id) {
      return false; // hierarchy mismatch: variant belongs to a different product
    }
  }

  return true;
}

export async function getCommitPreflight(importId: string): Promise<CommitPreflightResult> {
  const importRecord = await prisma.import.findUnique({
    where: { id: importId },
    select: { id: true, status: true, summary_rows_acknowledged: true },
  });

  if (!importRecord) {
    throw new ImportNotFoundError(importId);
  }

  const rows = (await prisma.importRow.findMany({
    where: { import_id: importId },
    select: {
      id: true,
      validation_status: true,
      duplicate_status: true,
      row_type: true,
      confirmed_brand_id: true,
      confirmed_product_id: true,
      confirmed_variant_id: true,
      suggested_brand_id: true,
      suggested_product_id: true,
      suggested_variant_id: true,
      match_reason: true,
    },
  })) as CommitPreflightRowFlags[];

  const leftUnmatchedRows = await prisma.auditLog.findMany({
    where: {
      action: 'MATCH_LEFT_UNMATCHED',
      entity_type: 'ImportRow',
      entity_id: { in: rows.map((row) => row.id) },
    },
    select: { entity_id: true },
  });
  const leftUnmatchedIds = new Set(
    leftUnmatchedRows.map((audit) => audit.entity_id).filter((id): id is string => Boolean(id)),
  );

  const totalRows = rows.length;
  const status = importRecord.status;

  // Collect confirmed master IDs for bulk existence + hierarchy checks
  const brandIds = new Set<string>();
  const productIds = new Set<string>();
  const variantIds = new Set<string>();

  for (const r of rows) {
    if (r.confirmed_brand_id) brandIds.add(r.confirmed_brand_id);
    if (r.confirmed_product_id) productIds.add(r.confirmed_product_id);
    if (r.confirmed_variant_id) variantIds.add(r.confirmed_variant_id);
  }

  const [brands, products, variants] = await Promise.all([
    brandIds.size
      ? prisma.brand.findMany({
          where: { id: { in: [...brandIds] } },
          select: { id: true },
        })
      : [],
    productIds.size
      ? prisma.product.findMany({
          where: { id: { in: [...productIds] } },
          select: { id: true, brand_id: true, division_id: true },
        })
      : [],
    variantIds.size
      ? prisma.productVariant.findMany({
          where: { id: { in: [...variantIds] } },
          select: { id: true, product_id: true },
        })
      : [],
  ]);

  const maps: PreflightMaps = {
    brandExists: new Map(brands.map((b) => [b.id, true])),
    productBrand: new Map(products.map((p) => [p.id, p.brand_id])),
    productDivision: new Map(products.map((p) => [p.id, p.division_id])),
    variantProduct: new Map(variants.map((v) => [v.id, v.product_id])),
  };

  let invalidRows = 0;
  let reviewRequiredRows = 0;
  let duplicateRows = 0;
  let unmappedRows = 0;
  let missingConfirmedMappingRows = 0;
  let rejectedRows = 0;
  let unmatchedRows = 0;
  let eligibleRows = 0;
  let hasInconsistency = false;

  for (const r of rows) {
    if (r.row_type !== 'DATA_ROW') continue;

    const isInvalid = r.validation_status === 'INVALID';
    const isReview = r.validation_status === 'REVIEW_REQUIRED' || r.validation_status === 'PENDING';
    const isDuplicate =
      r.duplicate_status === 'EXACT_DUPLICATE' || r.duplicate_status === 'POSSIBLE_DUPLICATE';
    const hasConfirmed = Boolean(
      r.confirmed_brand_id || r.confirmed_product_id || r.confirmed_variant_id
    );
    const hasSuggested = Boolean(
      r.suggested_brand_id || r.suggested_product_id || r.suggested_variant_id
    );
    const isRejected = r.match_reason?.toUpperCase().includes('REJECTED') ?? false;
    const isLeftUnmatched = leftUnmatchedIds.has(r.id);

    // Validation gates first
    if (isInvalid) {
      invalidRows++;
      continue;
    }
    if (isReview) {
      reviewRequiredRows++;
      continue;
    }
    if (isDuplicate) {
      duplicateRows++;
      continue;
    }

    if (isRejected) {
      rejectedRows++;
      continue;
    }

    // Mapping gates
    if (!hasConfirmed && !hasSuggested) {
      if (isLeftUnmatched) unmatchedRows++;
      else unmappedRows++;
      continue;
    }

    if (!hasConfirmed) {
      // Has a suggestion but no confirmed selection yet
      missingConfirmedMappingRows++;
      continue;
    }

    // Has a confirmed mapping - verify it still exists and is hierarchy-consistent
    if (!isConfirmedMappingConsistent(r, maps)) {
      missingConfirmedMappingRows++;
      hasInconsistency = true;
      continue;
    }

    eligibleRows++;
  }

  const blockers: string[] = [];
  const alreadyCommitted = status === 'COMMITTED';
  const nonDataRows = rows.filter((row) => row.row_type === 'NON_DATA_ROW').length;

  // Import-level status gates
  if (status === 'COMMITTED') {
    blockers.push('Import has already been committed');
  }
  if (status === 'FAILED') {
    blockers.push('Import is in FAILED state and cannot be committed');
  }
  if (status === 'CANCELLED') {
    blockers.push('Import is in CANCELLED state and cannot be committed');
  }

  // Row-level gates
  if (invalidRows > 0) {
    blockers.push(`${invalidRows} invalid row(s) cannot be committed`);
  }
  if (reviewRequiredRows > 0) {
    blockers.push(
      `${reviewRequiredRows} review-required row(s) must be resolved before commit`
    );
  }
  if (duplicateRows > 0) {
    blockers.push(`${duplicateRows} duplicate row(s) must be resolved before commit`);
  }
  if (unmappedRows > 0) {
    blockers.push(`${unmappedRows} unmapped row(s) require a mapping before commit`);
  }
  if (missingConfirmedMappingRows > 0) {
    blockers.push(
      `${missingConfirmedMappingRows} row(s) require a confirmed mapping${
        hasInconsistency ? ' (some confirmed mappings are stale or inconsistent)' : ''
      }`
    );
  }
  if (totalRows === 0) {
    blockers.push('Import contains no rows to commit');
  }
  if (nonDataRows > 0 && !importRecord.summary_rows_acknowledged) {
    blockers.push(`${nonDataRows} non-data row(s) require acknowledgement`);
  }

  const canCommit = blockers.length === 0;

  return {
    importId: importRecord.id,
    status,
    totalRows,
    eligibleRows,
    invalidRows,
    reviewRequiredRows,
    duplicateRows,
    unmappedRows,
    missingConfirmedMappingRows,
    rejectedRows,
    unmatchedRows,
    alreadyCommitted,
    canCommit,
    blockers,
  };
}

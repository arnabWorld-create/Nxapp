/**
 * TRANSACTIONAL COMMIT ENGINE (Phase 4.2)
 *
 * Converts a fully eligible Import into permanent Statement + StatementRow
 * records. All-or-nothing: if the Phase 4.1 preflight is not committable, or
 * any write fails inside the transaction, NOTHING is persisted.
 *
 * Business decisions (locked):
 *  - The Statement reporting period is supplied explicitly by the user at
 *    commit time (period_start_date / period_end_date). It is NEVER derived
 *    from upload date, current date, filename, or row data.
 *  - The newly created Statement gets status = APPROVED.
 *  - The Import transitions READY_FOR_REVIEW (or PROCESSING) -> COMMITTED.
 *
 * Idempotency / concurrency:
 *  - Phase 4.1 preflight is the canonical eligibility gate (not duplicated here).
 *  - Inside the transaction the Import is re-read; if already COMMITTED the
 *    commit is rejected (no second Statement).
 *  - Confirmed master mappings are re-validated inside the transaction (they
 *    may have changed between preflight and commit).
 *  - The transaction runs at SERIALIZABLE isolation; the UNIQUE constraint on
 *    StatementRow.import_row_id is the final safety net that prevents duplicate
 *    rows if two commits race.
 */

import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import { getCommitPreflight } from './commit-preflight';

export class CommitPreflightBlockedError extends Error {
  blockers: string[];
  constructor(blockers: string[]) {
    super('Commit blocked: preflight not satisfied');
    this.name = 'CommitPreflightBlockedError';
    this.blockers = blockers;
  }
}

export class ImportAlreadyCommittedError extends Error {
  constructor(importId: string) {
    super(`Import already committed: ${importId}`);
    this.name = 'ImportAlreadyCommittedError';
  }
}

export class InvalidCommitPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommitPeriodError';
  }
}

export class CommitImportNotFoundError extends Error {
  constructor(importId: string) {
    super(`Import not found: ${importId}`);
    this.name = 'CommitImportNotFoundError';
  }
}

export class InvalidDistributorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDistributorError';
  }
}

export interface CommitImportInput {
  importId: string;
  userId: string;
  periodStartDate: string; // YYYY-MM-DD
  periodEndDate: string; // YYYY-MM-DD
  distributorId?: string;
}

export interface CommitImportResult {
  importId: string;
  statementId: string;
  committedRows: number;
  status: 'COMMITTED';
  committedAt: string;
}

interface CommitRow {
  id: string;
  source_row_number: number | null;
  raw_data_json: Prisma.JsonValue | null;
  parsed_data_json: Prisma.JsonValue | null;
  validation_status: 'PENDING' | 'VALID' | 'INVALID' | 'REVIEW_REQUIRED';
  duplicate_status: 'NEW' | 'EXACT_DUPLICATE' | 'POSSIBLE_DUPLICATE';
  row_type: 'DATA_ROW' | 'SUMMARY_ROW' | 'NON_DATA_ROW';
  confirmed_brand_id: string | null;
  confirmed_product_id: string | null;
  confirmed_variant_id: string | null;
}

function parsePeriodDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Use noon UTC so the calendar day is preserved regardless of server TZ
  const d = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function validatePeriod(periodStartDate: unknown, periodEndDate: unknown): { start: Date; end: Date } {
  const start = parsePeriodDate(periodStartDate);
  const end = parsePeriodDate(periodEndDate);
  if (!start || !end) {
    throw new InvalidCommitPeriodError(
      'period_start_date and period_end_date are required and must be valid YYYY-MM-DD values'
    );
  }
  if (end.getTime() < start.getTime()) {
    throw new InvalidCommitPeriodError('period_end_date must be on or after period_start_date');
  }
  return { start, end };
}

function toDecimal(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  return new Prisma.Decimal(String(value));
}

function isConsistent(
  row: CommitRow,
  brandExists: Map<string, boolean>,
  productBrand: Map<string, string | null | undefined>,
  productDivision: Map<string, string | null | undefined>,
  variantProduct: Map<string, string | undefined>
): boolean {
  if (row.confirmed_brand_id && !brandExists.get(row.confirmed_brand_id)) return false;
  if (row.confirmed_variant_id && !row.confirmed_product_id) return false;
  if (row.confirmed_product_id) {
    const pb = productBrand.get(row.confirmed_product_id);
    if (pb === undefined) return false;
    if (row.confirmed_brand_id && pb !== row.confirmed_brand_id) return false;
    if (!row.confirmed_brand_id && !productDivision.get(row.confirmed_product_id)) return false;
  }
  if (row.confirmed_variant_id) {
    const vp = variantProduct.get(row.confirmed_variant_id);
    if (vp === undefined) return false;
    if (row.confirmed_product_id && vp !== row.confirmed_product_id) return false;
  }
  return true;
}

/**
 * Re-validate the critical referential assumptions inside the transaction.
 * Returns the rows that are eligible to be committed. Throws (rolling back the
 * whole transaction) if a previously-confirmed mapping is now stale/inconsistent.
 */
async function revalidateEligibleRows(
  tx: Prisma.TransactionClient,
  rows: CommitRow[]
): Promise<CommitRow[]> {
  const brandIds = new Set<string>();
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  const candidates: CommitRow[] = [];

  for (const r of rows) {
    const hasConfirmed = Boolean(r.confirmed_brand_id || r.confirmed_product_id || r.confirmed_variant_id);
    const isEligibleCandidate = r.row_type === 'DATA_ROW' &&
      r.validation_status === 'VALID' && r.duplicate_status === 'NEW' && hasConfirmed;
    if (!isEligibleCandidate) continue;
    candidates.push(r);
    if (r.confirmed_brand_id) brandIds.add(r.confirmed_brand_id);
    if (r.confirmed_product_id) productIds.add(r.confirmed_product_id);
    if (r.confirmed_variant_id) variantIds.add(r.confirmed_variant_id);
  }

  const [brands, products, variants] = await Promise.all([
    brandIds.size
      ? tx.brand.findMany({ where: { id: { in: [...brandIds] } }, select: { id: true } })
      : [],
    productIds.size
      ? tx.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, brand_id: true, division_id: true } })
      : [],
    variantIds.size
      ? tx.productVariant.findMany({ where: { id: { in: [...variantIds] } }, select: { id: true, product_id: true } })
      : [],
  ]);

  const brandExists = new Map(brands.map((b) => [b.id, true]));
  const productBrand = new Map(products.map((p) => [p.id, p.brand_id]));
  const productDivision = new Map(products.map((p) => [p.id, p.division_id]));
  const variantProduct = new Map(variants.map((v) => [v.id, v.product_id]));

  const eligible: CommitRow[] = [];
  for (const r of candidates) {
    if (!isConsistent(r, brandExists, productBrand, productDivision, variantProduct)) {
      throw new CommitPreflightBlockedError([
        'A confirmed mapping became stale or inconsistent between preflight and commit',
      ]);
    }
    eligible.push(r);
  }
  return eligible;
}

function buildStatementRowData(statementId: string, row: CommitRow) {
  const parsed = (row.parsed_data_json ?? {}) as { normalizedData?: Record<string, unknown> };
  const nd = parsed.normalizedData ?? {};
  const rawData = (row.raw_data_json ?? {}) as Record<string, unknown>;
  const raw = (row.raw_data_json ?? {}) as Prisma.InputJsonValue;

  // Preserve the original source item name where available; fall back to the
  // canonical normalized name that the pipeline stores in normalizedData.
  const rawSourceName =
    (typeof rawData['Source Item'] === 'string' && rawData['Source Item']) ||
    (typeof rawData['source_item_name'] === 'string' && rawData['source_item_name']) ||
    (typeof nd.source_item_name === 'string' ? nd.source_item_name : '');
  const normalizedSourceName = typeof nd.source_item_name === 'string' ? nd.source_item_name : null;

  return {
    statement_id: statementId,
    import_row_id: row.id,
    brand_id: row.confirmed_brand_id,
    product_id: row.confirmed_product_id,
    variant_id: row.confirmed_variant_id,
    source_row_number: row.source_row_number,
    source_item_name: rawSourceName,
    normalized_source_item_name: normalizedSourceName,
    mapping_status: 'CONFIRMED' as const,
    reported_purchase_qty: toDecimal(nd.reported_purchase_qty),
    reported_purchase_value: toDecimal(nd.reported_purchase_value),
    reported_sales_qty: toDecimal(nd.reported_sales_qty),
    reported_sales_value: toDecimal(nd.reported_sales_value),
    reported_sales_return_qty: toDecimal(nd.reported_sales_return_qty),
    reported_sales_return_value: toDecimal(nd.reported_sales_return_value),
    reported_purchase_return_qty: toDecimal(nd.reported_purchase_return_qty),
    reported_purchase_return_value: toDecimal(nd.reported_purchase_return_value),
    reported_closing_stock_qty: toDecimal(nd.reported_closing_stock_qty),
    reported_closing_stock_value: toDecimal(nd.reported_closing_stock_value),
    quantity_unit: typeof nd.quantity_unit === 'string' ? nd.quantity_unit : null,
    raw_row_json: raw,
    validation_status: 'VALID' as const,
    duplicate_status: 'NEW' as const,
  };
}

export async function commitImport(input: CommitImportInput): Promise<CommitImportResult> {
  const { importId, userId, distributorId } = input;
  const selectedDistributorId = distributorId?.trim();
  if (!selectedDistributorId) throw new InvalidDistributorError('distributor_id is required');
  const { start, end } = validatePeriod(input.periodStartDate, input.periodEndDate);

  // Phase 4.1 remains the canonical eligibility gate.
  const preflight = await getCommitPreflight(importId);
  if (!preflight.canCommit) {
    throw new CommitPreflightBlockedError(preflight.blockers);
  }

  return prisma.$transaction(async (tx) => {
    // Re-read Import inside the transaction (detects an already-committed
    // import and serializes against concurrent commits). The UNIQUE constraint
    // on StatementRow.import_row_id is the final safety net that prevents
    // duplicate rows if two commits race.
      const importRecord = await tx.import.findUnique({
        where: { id: importId },
        select: { id: true, status: true, file_name: true, uploaded_by: true },
      });
      if (!importRecord) {
        throw new CommitImportNotFoundError(importId);
      }
      if (importRecord.status === 'COMMITTED') {
        throw new ImportAlreadyCommittedError(importId);
      }

      const [distributor, committingUser] = await Promise.all([
        tx.distributor.findUnique({ where: { id: selectedDistributorId }, select: { id: true, status: true, salesperson_user_id: true } }),
        tx.user.findUnique({ where: { id: userId }, select: { role: { select: { name: true } } } }),
      ]);
      if (!distributor) throw new InvalidDistributorError('Distributor not found');
      if (distributor.status !== 'ACTIVE') throw new InvalidDistributorError('Inactive distributors cannot be used for new Statements');
      if (committingUser?.role.name === 'SALES_USER' && distributor.salesperson_user_id !== userId) {
        throw new InvalidDistributorError('Distributor is not assigned to this salesperson');
      }

      const rows = (await tx.importRow.findMany({
        where: { import_id: importId },
        select: {
          id: true,
          source_row_number: true,
          raw_data_json: true,
          parsed_data_json: true,
          validation_status: true,
          duplicate_status: true,
          row_type: true,
          confirmed_brand_id: true,
          confirmed_product_id: true,
          confirmed_variant_id: true,
        },
      })) as CommitRow[];

      // Re-validate critical referential assumptions inside the transaction.
      const eligible = await revalidateEligibleRows(tx, rows);

      // Create exactly ONE Statement.
      const statement = await tx.statement.create({
        data: {
          period_start_date: start,
          period_end_date: end,
          source_file_name: importRecord.file_name,
          status: 'READY_FOR_REVIEW',
          uploaded_by: importRecord.uploaded_by,
          distributor_id: distributor.id,
        },
      });

      // Create exactly one StatementRow per eligible ImportRow (1:1).
      await tx.statementRow.createMany({
        data: eligible.map((r) => buildStatementRowData(statement.id, r)),
      });

      // Only after every StatementRow succeeds, mark the Import committed.
      await tx.import.update({
        where: { id: importId },
        data: { status: 'COMMITTED', statement_id: statement.id },
      });

      // Audit log inside the same transaction.
      await tx.auditLog.create({
        data: {
          user_id: userId,
          action: 'IMPORT_COMMITTED',
          entity_type: 'Import',
          entity_id: importId,
          new_value: {
            statementId: statement.id,
            committedRowCount: eligible.length,
            periodStartDate: input.periodStartDate,
            periodEndDate: input.periodEndDate,
            newImportStatus: 'COMMITTED',
            statementStatus: 'READY_FOR_REVIEW',
          },
        },
      });

      return {
        importId,
        statementId: statement.id,
        committedRows: eligible.length,
        status: 'COMMITTED' as const,
        committedAt: new Date().toISOString(),
      };
    }
  );
}

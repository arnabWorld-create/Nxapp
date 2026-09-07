import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '../../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../../lib/auth';
import type { ReviewRequestQuery, ReviewRow, ReviewSummary, ReviewResponse } from '../../../../../lib/import/review-types';
import type { ValidationStatus } from '../../../../../lib/import/validation';
import type { DuplicateStatus } from '../../../../../lib/import/duplicates';
import type { MatchStatus } from '../../../../../lib/matching/types';

export type { ReviewRequestQuery, ReviewRow, ReviewSummary, ReviewResponse };

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function extractSourceItemName(rawData: Record<string, unknown>): string | null {
  // Look for common item name headers
  const possibleKeys = ['item', 'item_name', 'product', 'product_name', 'source_item_name', 'name', 'description'];
  for (const key of possibleKeys) {
    const value = rawData[key];
    if (value && typeof value === 'string') {
      return value;
    }
  }
  // Return first non-null string value
  for (const value of Object.values(rawData)) {
    if (value && typeof value === 'string') {
      return value;
    }
  }
  return null;
}

function extractNormalizedSourceItemName(normalizedData: any): string | null {
  return normalizedData?.source_item_name ?? null;
}

function extractSourceQuantityUnit(rawData: Record<string, unknown>): string | null {
  const unitKey = Object.keys(rawData).find((key) => /^(quantity\s*unit|qty\s*unit|unit|uom)$/i.test(key.trim()));
  const value = unitKey ? rawData[unitKey] : null;
  return value === null || value === undefined || value === '' ? null : String(value).trim() || null;
}

function nullMappingFields() {
  return {
    confirmed_brand_id: null,
    confirmed_product_id: null,
    confirmed_variant_id: null,
    suggested_brand_id: null,
    suggested_product_id: null,
    suggested_variant_id: null,
  };
}

function nullConfirmedFields() {
  return {
    confirmed_brand_id: null,
    confirmed_product_id: null,
    confirmed_variant_id: null,
  };
}

function buildMappingFilter(mappingStatus: MatchStatus): Prisma.ImportRowWhereInput {
  const noMapping = nullMappingFields();
  if (mappingStatus === 'IGNORED') {
    return { row_type: 'SUMMARY_ROW' };
  }
  const dataRow = { row_type: 'DATA_ROW' as const };
  if (mappingStatus === 'CONFIRMED') {
    return { AND: [dataRow, { OR: [{ confirmed_brand_id: { not: null } }, { confirmed_product_id: { not: null } }, { confirmed_variant_id: { not: null } }] }] };
  }
  if (mappingStatus === 'SUGGESTED') {
    return { AND: [dataRow, nullConfirmedFields(), { OR: [{ suggested_brand_id: { not: null } }, { suggested_product_id: { not: null } }, { suggested_variant_id: { not: null } }] }] };
  }
  if (mappingStatus === 'REJECTED') {
    return { AND: [dataRow, noMapping, { match_reason: { contains: 'REJECTED', mode: 'insensitive' } }] };
  }
  return {
    AND: [
      dataRow,
      noMapping,
      { OR: [{ match_reason: null }, { NOT: { match_reason: { contains: 'REJECTED', mode: 'insensitive' } } }] },
    ],
  };
}

async function findSearchMatches(importId: string, search: string): Promise<string[]> {
  const pattern = `%${search}%`;
  const matches = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT ir.id
    FROM "ImportRow" ir
    WHERE ir.import_id = ${importId}
      AND (
        CAST(ir.source_row_number AS TEXT) ILIKE ${pattern}
        OR (ir.parsed_data_json->'normalizedData'->>'source_item_name') ILIKE ${pattern}
        OR EXISTS (
          SELECT 1
          FROM jsonb_each_text(ir.raw_data_json) AS source_value(key, value)
          WHERE source_value.value ILIKE ${pattern}
        )
      )
  `);
  return matches.map((match) => match.id);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: importId } = await params;

    // Parse query parameters
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10)));
    const search = url.searchParams.get('search')?.trim() ?? '';
    const validationStatus = url.searchParams.get('validationStatus') as ValidationStatus | null;
    const duplicateStatus = url.searchParams.get('duplicateStatus') as DuplicateStatus | null;
    const mappingStatus = url.searchParams.get('mappingStatus') as MatchStatus | null;
    const rowType = url.searchParams.get('rowType') as 'DATA_ROW' | 'SUMMARY_ROW' | 'NON_DATA_ROW' | null;

    // Get user from session or legacy header
    const userId = await resolveUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    }

    // Check authorization
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 403 });
    }

    if (!userHasPermission(user, 'review_import')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // Get import record
    const importRecord = await prisma.import.findUnique({
      where: { id: importId },
      include: {
        uploaded_by_user: true,
      },
    });

    if (!importRecord) {
      return NextResponse.json({ error: 'Import not found' }, { status: 404 });
    }

    // Verify user owns the import or has admin permission
    if (importRecord.uploaded_by !== user.id && user.role?.name !== 'ADMIN') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Helper to determine mapping status. The data model exposes only explicit
    // confirmation/suggestion state; there is no rejected_at field in the schema.
    const determineMappingStatus = (row: any): MatchStatus => {
      if (row.row_type === 'SUMMARY_ROW') return 'IGNORED';
      if (row.confirmed_brand_id || row.confirmed_product_id || row.confirmed_variant_id) {
        return 'CONFIRMED';
      }
      if (row.suggested_brand_id || row.suggested_product_id || row.suggested_variant_id) {
        return 'SUGGESTED';
      }
      if (row.match_reason && row.match_reason.toUpperCase().includes('REJECTED')) {
        return 'REJECTED';
      }
      return 'UNMATCHED';
    };

    // Build database predicates before pagination.
    const whereConditions: Prisma.ImportRowWhereInput = {
      import_id: importId,
    };

    if (validationStatus) {
      whereConditions.validation_status = validationStatus;
    }

    if (duplicateStatus) {
      whereConditions.duplicate_status = duplicateStatus;
    }
    if (rowType) {
      whereConditions.row_type = rowType;
    }

    const skip = (page - 1) * pageSize;

    if (mappingStatus) {
      Object.assign(whereConditions, buildMappingFilter(mappingStatus));
    }

    if (search) {
      const searchIds = await findSearchMatches(importId, search);
      whereConditions.id = { in: searchIds };
    }

    const filteredTotalRows = await prisma.importRow.count({ where: whereConditions });
    const rowsForPage = await prisma.importRow.findMany({
      where: whereConditions,
      skip,
      take: pageSize,
      orderBy: { source_row_number: 'asc' },
      include: {
        confirmed_brand: { select: { id: true, name: true } },
        confirmed_product: { select: { id: true, name: true } },
        confirmed_variant: { select: { id: true, variant_name: true } },
        suggested_brand: { select: { id: true, name: true } },
        suggested_product: { select: { id: true, name: true } },
        suggested_variant: { select: { id: true, variant_name: true } },
        confirmed_by_user: { select: { id: true } },
      },
    });

    // Calculate summary stats with grouped/count queries; never materialize the import.
    const [statusGroups, duplicateGroups, rowTypeGroups, unmatchedRows, suggestedRows, confirmedRows, rejectedRows, dataRowsMissingQuantityUnit] = await Promise.all([
      prisma.importRow.groupBy({ by: ['validation_status'], where: { import_id: importId }, _count: { _all: true } }),
      prisma.importRow.groupBy({ by: ['duplicate_status'], where: { import_id: importId, row_type: 'DATA_ROW' }, _count: { _all: true } }),
      prisma.importRow.groupBy({ by: ['row_type'], where: { import_id: importId }, _count: { _all: true } }),
      prisma.importRow.count({ where: { import_id: importId, ...buildMappingFilter('UNMATCHED') } }),
      prisma.importRow.count({ where: { import_id: importId, ...buildMappingFilter('SUGGESTED') } }),
      prisma.importRow.count({ where: { import_id: importId, ...buildMappingFilter('CONFIRMED') } }),
      prisma.importRow.count({ where: { import_id: importId, ...buildMappingFilter('REJECTED') } }),
      prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "ImportRow"
        WHERE import_id = ${importId}
          AND row_type = 'DATA_ROW'
          AND COALESCE(parsed_data_json->'normalizedData'->>'quantity_unit', '') = ''
      `),
    ]);
    const statusCount = (status: ValidationStatus) => statusGroups.find((group) => group.validation_status === status)?._count._all ?? 0;
    const duplicateCount = (status: DuplicateStatus) => duplicateGroups.find((group) => group.duplicate_status === status)?._count._all ?? 0;
    const rowTypeCount = (type: 'SUMMARY_ROW' | 'NON_DATA_ROW') => rowTypeGroups.find((group) => group.row_type === type)?._count._all ?? 0;
    const summary: ReviewSummary = {
      totalRows: statusGroups.reduce((total, group) => total + group._count._all, 0),
      validRows: statusCount('VALID'),
      invalidRows: statusCount('INVALID'),
      reviewRequiredRows: statusCount('REVIEW_REQUIRED'),
      exactDuplicates: duplicateCount('EXACT_DUPLICATE'),
      possibleDuplicates: duplicateCount('POSSIBLE_DUPLICATE'),
      unmatchedRows,
      suggestedRows,
      confirmedRows,
      rejectedRows,
      summaryRows: rowTypeCount('SUMMARY_ROW'),
      nonDataRows: rowTypeCount('NON_DATA_ROW'),
      dataRowsMissingQuantityUnit: Number(dataRowsMissingQuantityUnit[0]?.count ?? 0),
    };

    // Transform to response format
    const rows: ReviewRow[] = rowsForPage.map((row) => {
      const rawData = row.raw_data_json as Record<string, unknown>;
      const parsedData = row.parsed_data_json as any;
      const mappingStatus = determineMappingStatus(row);
      const sourceQuantityUnit = extractSourceQuantityUnit(rawData);
      const quantityUnit = parsedData?.normalizedData?.quantity_unit ?? null;

      const reviewRow: ReviewRow = {
        id: row.id,
        sourceRowNumber: row.source_row_number,
        rowType: row.row_type,
        nonDataReason: row.non_data_reason,
        sourceItemName: extractSourceItemName(rawData),
        normalizedSourceItemName: extractNormalizedSourceItemName(parsedData?.normalizedData),
        reportedPurchaseQty: parsedData?.normalizedData?.reported_purchase_qty ?? null,
        reportedPurchaseValue: parsedData?.normalizedData?.reported_purchase_value ?? null,
        reportedSalesQty: parsedData?.normalizedData?.reported_sales_qty ?? null,
        reportedSalesValue: parsedData?.normalizedData?.reported_sales_value ?? null,
        reportedClosingStockQty: parsedData?.normalizedData?.reported_closing_stock_qty ?? null,
        reportedClosingStockValue: parsedData?.normalizedData?.reported_closing_stock_value ?? null,
        quantityUnit,
        sourceQuantityUnit,
        quantityUnitResolution: sourceQuantityUnit
          ? 'EXPLICIT_SOURCE'
          : quantityUnit && importRecord.default_quantity_unit_confirmed
            ? 'FILE_DEFAULT'
            : 'UNRESOLVED',
        validationStatus: row.validation_status,
        duplicateStatus: row.duplicate_status,
        mappingStatus,
        mappingLabel: row.row_type === 'SUMMARY_ROW'
          ? 'IGNORED / EXCLUDED'
          : row.match_reason?.startsWith('AUTO_MATCHED:')
          ? 'AUTO MATCHED'
          : row.match_reason?.startsWith('PREVIOUSLY_CONFIRMED:')
            ? 'PREVIOUSLY CONFIRMED'
            : undefined,
        confirmedBrand: row.confirmed_brand
          ? { id: row.confirmed_brand.id, name: row.confirmed_brand.name }
          : null,
        confirmedProduct: row.confirmed_product
          ? { id: row.confirmed_product.id, name: row.confirmed_product.name }
          : null,
        confirmedVariant: row.confirmed_variant
          ? { id: row.confirmed_variant.id, name: row.confirmed_variant.variant_name }
          : null,
        suggestedBrand: row.suggested_brand
          ? { id: row.suggested_brand.id, name: row.suggested_brand.name }
          : null,
        suggestedProduct: row.suggested_product
          ? { id: row.suggested_product.id, name: row.suggested_product.name }
          : null,
        suggestedVariant: row.suggested_variant
          ? { id: row.suggested_variant.id, name: row.suggested_variant.variant_name }
          : null,
        rawData,
        normalizedData: parsedData?.normalizedData ?? null,
        validationIssues: parsedData?.validationIssues ?? [],
        duplicateResult: parsedData?.duplicateResult ?? undefined,
      };

      // Add confirmed match if exists
      if (row.confirmed_variant) {
        reviewRow.confirmedMatch = {
          entityType: 'VARIANT',
          entityId: row.confirmed_variant.id,
          entityName: row.confirmed_variant.variant_name,
          confirmedAt: row.confirmed_at?.toISOString() || new Date().toISOString(),
          confirmedBy: row.confirmed_by_user?.id || null,
          reason: row.match_reason || null,
        };
      } else if (row.confirmed_product) {
        reviewRow.confirmedMatch = {
          entityType: 'PRODUCT',
          entityId: row.confirmed_product.id,
          entityName: row.confirmed_product.name,
          confirmedAt: row.confirmed_at?.toISOString() || new Date().toISOString(),
          confirmedBy: row.confirmed_by_user?.id || null,
          reason: row.match_reason || null,
        };
      } else if (row.confirmed_brand) {
        reviewRow.confirmedMatch = {
          entityType: 'BRAND',
          entityId: row.confirmed_brand.id,
          entityName: row.confirmed_brand.name,
          confirmedAt: row.confirmed_at?.toISOString() || new Date().toISOString(),
          confirmedBy: row.confirmed_by_user?.id || null,
          reason: row.match_reason || null,
        };
      }

      return reviewRow;
    });

    const totalPages = Math.ceil(filteredTotalRows / pageSize);

    return NextResponse.json(
      {
        import: {
          id: importRecord.id,
          fileName: importRecord.file_name,
          fileType: importRecord.file_type,
          status: importRecord.status,
          createdAt: importRecord.created_at.toISOString(),
          uploadedBy: importRecord.uploaded_by,
          defaultQuantityUnit: importRecord.default_quantity_unit,
          defaultQuantityUnitConfirmed: importRecord.default_quantity_unit_confirmed,
          defaultQuantityUnitConfirmedBy: importRecord.default_quantity_unit_confirmed_by,
          defaultQuantityUnitConfirmedAt: importRecord.default_quantity_unit_confirmed_at?.toISOString() ?? null,
          summaryRowsAcknowledged: importRecord.summary_rows_acknowledged,
          summaryRowsAcknowledgedBy: importRecord.summary_rows_acknowledged_by,
          summaryRowsAcknowledgedAt: importRecord.summary_rows_acknowledged_at?.toISOString() ?? null,
        },
        summary,
        pagination: {
          page,
          pageSize,
          totalPages,
          totalRows: filteredTotalRows,
        },
        rows,
      } as ReviewResponse,
      { status: 200 }
    );
  } catch (error) {
    console.error('Review endpoint error:', error);
    return NextResponse.json({ error: 'Unable to retrieve review data' }, { status: 500 });
  }
}

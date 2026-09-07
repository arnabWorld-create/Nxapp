import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { resolveUserIdFromRequest } from '../../../../lib/auth';
import { getUserById, userHasPermission } from '../../../../lib/import/upload';
import type { ValidationStatus } from '../../../../lib/import/validation';
import type { DuplicateStatus } from '../../../../lib/import/duplicates';

export interface ReviewRequestQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  validationStatus?: ValidationStatus;
  duplicateStatus?: DuplicateStatus;
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
  validationStatus: ValidationStatus;
  duplicateStatus: DuplicateStatus;
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
}

export interface ReviewResponse {
  import: {
    id: string;
    fileName: string;
    fileType: string;
    status: string;
    createdAt: string;
    uploadedBy: string | null;
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

    const userId = await resolveUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    }

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

    if (importRecord.uploaded_by !== user.id && user.role?.name !== 'ADMIN') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Build filter conditions
    const whereConditions: any = {
      import_id: importId,
    };

    if (validationStatus) {
      whereConditions.validation_status = validationStatus;
    }

    if (duplicateStatus) {
      whereConditions.duplicate_status = duplicateStatus;
    }

    // Get total count
    const totalRows = await prisma.importRow.count({
      where: whereConditions,
    });

    // Fetch paginated rows
    const skip = (page - 1) * pageSize;
    const importRows = await prisma.importRow.findMany({
      where: whereConditions,
      skip,
      take: pageSize,
      orderBy: {
        source_row_number: 'asc',
      },
    });

    // Calculate summary stats
    const allImportRows = await prisma.importRow.findMany({
      where: {
        import_id: importId,
      },
      select: {
        validation_status: true,
        duplicate_status: true,
      },
    });

    const summary: ReviewSummary = {
      totalRows: allImportRows.length,
      validRows: allImportRows.filter((r) => r.validation_status === 'VALID').length,
      invalidRows: allImportRows.filter((r) => r.validation_status === 'INVALID').length,
      reviewRequiredRows: allImportRows.filter((r) => r.validation_status === 'REVIEW_REQUIRED').length,
      exactDuplicates: allImportRows.filter((r) => r.duplicate_status === 'EXACT_DUPLICATE').length,
      possibleDuplicates: allImportRows.filter((r) => r.duplicate_status === 'POSSIBLE_DUPLICATE').length,
    };

    // Apply search filter on client-side (in-memory)
    let filteredRows = importRows;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredRows = importRows.filter((row) => {
        const rawData = row.raw_data_json as Record<string, unknown>;
        const parsedData = row.parsed_data_json as any;
        const sourceItemName = extractSourceItemName(rawData);
        const normalizedItemName = extractNormalizedSourceItemName(parsedData?.normalizedData);

        return (
          sourceItemName?.toLowerCase().includes(searchLower) ||
          normalizedItemName?.toLowerCase().includes(searchLower) ||
          row.source_row_number?.toString().includes(search)
        );
      });
    }

    // Transform to response format
    const rows: ReviewRow[] = filteredRows.map((row) => {
      const rawData = row.raw_data_json as Record<string, unknown>;
      const parsedData = row.parsed_data_json as any;

      return {
        id: row.id,
        sourceRowNumber: row.source_row_number,
        sourceItemName: extractSourceItemName(rawData),
        normalizedSourceItemName: extractNormalizedSourceItemName(parsedData?.normalizedData),
        reportedPurchaseQty: parsedData?.normalizedData?.reported_purchase_qty ?? null,
        reportedPurchaseValue: parsedData?.normalizedData?.reported_purchase_value ?? null,
        reportedSalesQty: parsedData?.normalizedData?.reported_sales_qty ?? null,
        reportedSalesValue: parsedData?.normalizedData?.reported_sales_value ?? null,
        reportedClosingStockQty: parsedData?.normalizedData?.reported_closing_stock_qty ?? null,
        reportedClosingStockValue: parsedData?.normalizedData?.reported_closing_stock_value ?? null,
        quantityUnit: parsedData?.normalizedData?.quantity_unit ?? null,
        validationStatus: row.validation_status,
        duplicateStatus: row.duplicate_status,
        rawData,
        normalizedData: parsedData?.normalizedData ?? null,
        validationIssues: parsedData?.validationIssues ?? [],
        duplicateResult: parsedData?.duplicateResult ?? undefined,
      };
    });

    const totalPages = Math.ceil(totalRows / pageSize);

    return NextResponse.json(
      {
        import: {
          id: importRecord.id,
          fileName: importRecord.file_name,
          fileType: importRecord.file_type,
          status: importRecord.status,
          createdAt: importRecord.created_at.toISOString(),
          uploadedBy: importRecord.uploaded_by,
        },
        summary,
        pagination: {
          page,
          pageSize,
          totalPages,
          totalRows,
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

import { NextResponse } from 'next/server';
import { AuthorizationError, ValidationError, processImportUpload } from '../../../lib/import/upload';
import { getUserById } from '../../../lib/import/upload';
import prisma from '../../../lib/prisma';
import { processImport } from '../../../lib/import/process';
import { resolveUserIdFromRequest } from '../../../lib/auth';
import { Prisma } from '@prisma/client';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Content-Type must be multipart/form-data' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const userId = await resolveUserIdFromRequest(request);

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'A file upload is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Missing authentication for server-side authorization' }, { status: 401 });
    }

    const result = await processImportUpload(file, userId);

    // Process the import asynchronously
    processImport(result.importRecord.id).catch((error) => {
      console.error('Import processing failed:', error);
    });

    return NextResponse.json({ import: result.importRecord }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    return NextResponse.json({ error: 'Unable to process upload' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const userId = await resolveUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 403 });

    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(url.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
    const search = url.searchParams.get('search')?.trim() ?? '';
    const status = url.searchParams.get('status');
    const where: Prisma.ImportWhereInput = user.role?.name === 'ADMIN' ? {} : { uploaded_by: user.id };
    if (search) where.file_name = { contains: search, mode: 'insensitive' };
    if (status) where.status = status as Prisma.EnumImportStatusFilter['equals'];

    const [total, imports] = await Promise.all([
      prisma.import.count({ where }),
      prisma.import.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, file_name: true, file_type: true, status: true, created_at: true, failure_stage: true, failure_message: true, failed_at: true,
          uploaded_by_user: { select: { id: true, name: true, email: true } },
          statement: { select: { id: true, source_file_name: true, status: true, period_start_date: true, period_end_date: true, distributor: { select: { id: true, name: true } } } },
        },
      }),
    ]);
    const ids = imports.map((item) => item.id);
    const aggregates = ids.length
      ? await prisma.$queryRaw<Array<{ import_id: string; total_rows: bigint; valid_rows: bigint; invalid_rows: bigint; review_required_rows: bigint; duplicate_rows: bigint; data_rows: bigint; summary_rows: bigint; non_data_rows: bigint; confirmed_mapping_rows: bigint; commit_eligible_rows: bigint }>>(Prisma.sql`
          SELECT ir.import_id,
            COUNT(*)::bigint AS total_rows,
            COUNT(*) FILTER (WHERE ir.validation_status = 'VALID')::bigint AS valid_rows,
            COUNT(*) FILTER (WHERE ir.validation_status = 'INVALID')::bigint AS invalid_rows,
            COUNT(*) FILTER (WHERE ir.validation_status = 'REVIEW_REQUIRED')::bigint AS review_required_rows,
            COUNT(*) FILTER (WHERE ir.duplicate_status IN ('EXACT_DUPLICATE', 'POSSIBLE_DUPLICATE'))::bigint AS duplicate_rows,
            COUNT(*) FILTER (WHERE ir.row_type = 'DATA_ROW')::bigint AS data_rows,
            COUNT(*) FILTER (WHERE ir.row_type = 'SUMMARY_ROW')::bigint AS summary_rows,
            COUNT(*) FILTER (WHERE ir.row_type = 'NON_DATA_ROW')::bigint AS non_data_rows,
            COUNT(*) FILTER (WHERE ir.confirmed_brand_id IS NOT NULL OR ir.confirmed_product_id IS NOT NULL OR ir.confirmed_variant_id IS NOT NULL)::bigint AS confirmed_mapping_rows,
            COUNT(*) FILTER (WHERE ir.row_type = 'DATA_ROW' AND ir.validation_status = 'VALID' AND ir.duplicate_status = 'NEW'
              AND (ir.confirmed_brand_id IS NOT NULL OR ir.confirmed_product_id IS NOT NULL OR ir.confirmed_variant_id IS NOT NULL)
              AND (ir.confirmed_brand_id IS NULL OR b.id IS NOT NULL)
              AND (ir.confirmed_product_id IS NULL OR (p.id IS NOT NULL AND (ir.confirmed_brand_id IS NULL OR p.brand_id = ir.confirmed_brand_id)))
              AND (ir.confirmed_product_id IS NULL OR ir.confirmed_brand_id IS NOT NULL OR p.division_id IS NOT NULL)
              AND (ir.confirmed_variant_id IS NULL OR (v.id IS NOT NULL AND ir.confirmed_product_id IS NOT NULL AND v.product_id = ir.confirmed_product_id))
            )::bigint AS commit_eligible_rows
          FROM "ImportRow" ir
          LEFT JOIN "Brand" b ON b.id = ir.confirmed_brand_id
          LEFT JOIN "Product" p ON p.id = ir.confirmed_product_id
          LEFT JOIN "ProductVariant" v ON v.id = ir.confirmed_variant_id
          WHERE ir.import_id IN (${Prisma.join(ids)})
          GROUP BY ir.import_id
        `)
      : [];
    const aggregateMap = new Map(aggregates.map((item) => [item.import_id, item]));
    const toNumber = (value: bigint | undefined) => Number(value ?? 0);
    return NextResponse.json({
      imports: imports.map((item) => {
        const aggregate = aggregateMap.get(item.id);
        return {
          id: item.id,
          fileName: item.file_name,
          fileType: item.file_type,
          status: item.status,
          createdAt: item.created_at.toISOString(),
          failureStage: item.failure_stage,
          failureMessage: item.failure_message,
          failedAt: item.failed_at?.toISOString() ?? null,
          uploadedBy: item.uploaded_by_user,
          aggregates: {
            totalRows: toNumber(aggregate?.total_rows), validRows: toNumber(aggregate?.valid_rows), invalidRows: toNumber(aggregate?.invalid_rows), reviewRequiredRows: toNumber(aggregate?.review_required_rows), duplicateRows: toNumber(aggregate?.duplicate_rows), dataRows: toNumber(aggregate?.data_rows), summaryRows: toNumber(aggregate?.summary_rows), nonDataRows: toNumber(aggregate?.non_data_rows), confirmedMappingRows: toNumber(aggregate?.confirmed_mapping_rows), commitEligibleRows: toNumber(aggregate?.commit_eligible_rows),
          },
          statement: item.statement ? { id: item.statement.id, fileName: item.statement.source_file_name, status: item.statement.status, periodStartDate: item.statement.period_start_date.toISOString().slice(0, 10), periodEndDate: item.statement.period_end_date.toISOString().slice(0, 10), distributor: item.statement.distributor } : null,
        };
      }),
      total, page, pageSize, totalPages: Math.ceil(total / pageSize),
    }, { status: 200 });
  } catch (error) {
    console.error('Import history error:', error);
    return NextResponse.json({ error: 'Unable to retrieve import history' }, { status: 500 });
  }
}

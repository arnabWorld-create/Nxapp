import { NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../../lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50', 10)));
    const search = url.searchParams.get('search')?.trim() ?? '';
    const divisionId = url.searchParams.get('division_id')?.trim() ?? '';
    const productId = url.searchParams.get('product_id')?.trim() ?? '';
    const variantId = url.searchParams.get('variant_id')?.trim() ?? '';
    const mappingStatus = url.searchParams.get('mapping_status')?.trim() ?? '';
    const validationStatus = url.searchParams.get('validation_status')?.trim() ?? '';

    const userId = await resolveUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 403 });
    }

    if (!userHasPermission(user, 'view_statement')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const canViewAll = user.role?.name === 'ADMIN' || user.role?.name === 'MANAGER';

    // First check if statement exists and user has access
    const statement = await prisma.statement.findUnique({
      where: { id },
      select: { id: true, uploaded_by: true },
    });

    if (!statement) {
      return NextResponse.json({ error: 'Statement not found' }, { status: 404 });
    }

    if (!canViewAll && statement.uploaded_by !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Build where conditions
    const whereConditions: any = { statement_id: id };

    if (search) {
      whereConditions.OR = [
        { source_item_name: { contains: search, mode: 'insensitive' } },
        { normalized_source_item_name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (divisionId) whereConditions.product = { division_id: divisionId };
    if (productId) whereConditions.product_id = productId;
    if (variantId) whereConditions.variant_id = variantId;
    if (mappingStatus) whereConditions.mapping_status = mappingStatus;
    if (validationStatus) whereConditions.validation_status = validationStatus;

    const [rows, totalCount] = await Promise.all([
      prisma.statementRow.findMany({
        where: whereConditions,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { source_row_number: 'asc' },
        include: {
          brand: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, brand_id: true, division_id: true, division: { select: { id: true, name: true } } } },
          variant: { select: { id: true, variant_name: true, product_id: true } },
        },
      }),
      prisma.statementRow.count({ where: whereConditions }),
    ]);

    return NextResponse.json(
      {
        rows: rows.map((r) => ({
          id: r.id,
          source_row_number: r.source_row_number,
          source_item_name: r.source_item_name,
          normalized_source_item_name: r.normalized_source_item_name,
          brand: r.brand ? { id: r.brand.id, name: r.brand.name } : null,
          product: r.product ? { id: r.product.id, name: r.product.name, brand_id: r.product.brand_id, division_id: r.product.division_id, division: r.product.division } : null,
          variant: r.variant ? { id: r.variant.id, variant_name: r.variant.variant_name, product_id: r.variant.product_id } : null,
          reported_purchase_qty: r.reported_purchase_qty?.toString() ?? null,
          reported_purchase_value: r.reported_purchase_value?.toString() ?? null,
          reported_sales_qty: r.reported_sales_qty?.toString() ?? null,
          reported_sales_value: r.reported_sales_value?.toString() ?? null,
          reported_sales_return_qty: r.reported_sales_return_qty?.toString() ?? null,
          reported_sales_return_value: r.reported_sales_return_value?.toString() ?? null,
          reported_purchase_return_qty: r.reported_purchase_return_qty?.toString() ?? null,
          reported_purchase_return_value: r.reported_purchase_return_value?.toString() ?? null,
          reported_closing_stock_qty: r.reported_closing_stock_qty?.toString() ?? null,
          reported_closing_stock_value: r.reported_closing_stock_value?.toString() ?? null,
          quantity_unit: r.quantity_unit,
          mapping_status: r.mapping_status,
          validation_status: r.validation_status,
          duplicate_status: r.duplicate_status,
        })),
        pagination: {
          page,
          pageSize,
          totalPages: Math.ceil(totalCount / pageSize),
          totalCount,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Statement rows error:', error);
    return NextResponse.json({ error: 'Unable to retrieve statement rows' }, { status: 500 });
  }
}
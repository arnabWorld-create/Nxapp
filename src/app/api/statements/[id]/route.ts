import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

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

    const statement = await prisma.statement.findUnique({
      where: { id },
      include: {
        uploaded_by_user: { select: { id: true, name: true, email: true } },
        approved_by_user: { select: { id: true, name: true, email: true } },
        distributor: { select: { id: true, name: true, salesperson: { select: { id: true, name: true, email: true } } } },
        _count: { select: { statement_rows: true } },
      },
    });

    if (!statement) {
      return NextResponse.json({ error: 'Statement not found' }, { status: 404 });
    }

    // Check ownership
    if (!canViewAll && statement.uploaded_by !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Get aggregates for the statement
    const aggregates = await prisma.statementRow.groupBy({
      by: ['statement_id'],
      where: { statement_id: id },
      _sum: {
        reported_purchase_qty: true,
        reported_purchase_value: true,
        reported_sales_qty: true,
        reported_sales_value: true,
        reported_sales_return_qty: true,
        reported_sales_return_value: true,
        reported_purchase_return_qty: true,
        reported_purchase_return_value: true,
        reported_closing_stock_qty: true,
        reported_closing_stock_value: true,
      },
      _count: { id: true },
    });

    const agg = aggregates[0] ?? {
      _sum: {},
      _count: { id: 0 },
    };

    return NextResponse.json(
      {
        statement: {
          id: statement.id,
          name: statement.name,
          period_start_date: statement.period_start_date.toISOString().slice(0, 10),
          period_end_date: statement.period_end_date.toISOString().slice(0, 10),
          source_file_name: statement.source_file_name,
          source_file_path: statement.source_file_path,
          status: statement.status,
          uploaded_by: statement.uploaded_by,
          uploaded_by_user: statement.uploaded_by_user,
          distributor: statement.distributor,
          approved_by: statement.approved_by_user,
          approved_at: statement.approved_at?.toISOString() ?? null,
          approval_note: statement.approval_note,
          created_at: statement.created_at.toISOString(),
          updated_at: statement.updated_at.toISOString(),
          row_count: statement._count.statement_rows,
          aggregates: {
            reported_purchase_qty: agg._sum.reported_purchase_qty?.toString() ?? '0',
            reported_purchase_value: agg._sum.reported_purchase_value?.toString() ?? '0',
            reported_sales_qty: agg._sum.reported_sales_qty?.toString() ?? '0',
            reported_sales_value: agg._sum.reported_sales_value?.toString() ?? '0',
            reported_sales_return_qty: agg._sum.reported_sales_return_qty?.toString() ?? '0',
            reported_sales_return_value: agg._sum.reported_sales_return_value?.toString() ?? '0',
            reported_purchase_return_qty: agg._sum.reported_purchase_return_qty?.toString() ?? '0',
            reported_purchase_return_value: agg._sum.reported_purchase_return_value?.toString() ?? '0',
            reported_closing_stock_qty: agg._sum.reported_closing_stock_qty?.toString() ?? '0',
            reported_closing_stock_value: agg._sum.reported_closing_stock_value?.toString() ?? '0',
            total_rows: agg._count.id,
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Statement detail error:', error);
    return NextResponse.json({ error: 'Unable to retrieve statement' }, { status: 500 });
  }
}
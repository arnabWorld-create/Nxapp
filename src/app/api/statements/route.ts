import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../lib/auth';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '20', 10)));
    const search = url.searchParams.get('search')?.trim() ?? '';
    const status = url.searchParams.get('status')?.trim() ?? '';
    const divisionId = url.searchParams.get('division_id')?.trim() ?? '';
    const productId = url.searchParams.get('product_id')?.trim() ?? '';
    const startDate = url.searchParams.get('start_date')?.trim() ?? '';
    const endDate = url.searchParams.get('end_date')?.trim() ?? '';
    const distributorId = url.searchParams.get('distributor_id')?.trim() ?? '';

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

    // Build where conditions
    const whereConditions: any = {};

    if (search) {
      whereConditions.OR = [
        { source_file_name: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      whereConditions.status = status;
    }
    if (distributorId) whereConditions.distributor_id = distributorId;

    if (startDate || endDate) {
      whereConditions.period_start_date = {};
      if (startDate) whereConditions.period_start_date.gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) whereConditions.period_start_date.lte = new Date(`${endDate}T23:59:59.999Z`);
    }

    // For brand/product filtering, we need to join through statement_rows
    if (divisionId || productId) {
      whereConditions.statement_rows = {
        some: {},
      };
      if (divisionId) whereConditions.statement_rows.some.product = { division_id: divisionId };
      if (productId) {
        whereConditions.statement_rows.some.product_id = productId;
      }
    }

    // Non-admin users only see statements they uploaded
    if (!canViewAll) {
      whereConditions.uploaded_by = user.id;
    }

    const [statements, totalCount] = await Promise.all([
      prisma.statement.findMany({
        where: whereConditions,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { created_at: 'desc' },
        include: {
          uploaded_by_user: { select: { id: true, name: true, email: true } },
          distributor: { select: { id: true, name: true, salesperson: { select: { id: true, name: true, email: true } } } },
          _count: { select: { statement_rows: true } },
        },
      }),
      prisma.statement.count({ where: whereConditions }),
    ]);

    return NextResponse.json(
      {
        statements: statements.map((s) => ({
          id: s.id,
          name: s.name,
          period_start_date: s.period_start_date.toISOString().slice(0, 10),
          period_end_date: s.period_end_date.toISOString().slice(0, 10),
          source_file_name: s.source_file_name,
          status: s.status,
          uploaded_by: s.uploaded_by,
          uploaded_by_user: s.uploaded_by_user,
          distributor: s.distributor,
          created_at: s.created_at.toISOString(),
          row_count: s._count.statement_rows,
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
    console.error('Statements list error:', error);
    return NextResponse.json({ error: 'Unable to retrieve statements' }, { status: 500 });
  }
}
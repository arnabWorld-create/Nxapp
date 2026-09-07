import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import prisma from '../../../lib/prisma';
import { getUserById, userHasPermission } from '../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../lib/auth';
import { getSalesAnalytics } from '../../../lib/reporting/sales-analytics';

export async function GET(request: Request) {
  try {
    const userId = await resolveUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 403 });
    }

    const canViewAll = user.role?.name === 'ADMIN' || user.role?.name === 'MANAGER';
    const salesAnalytics = await getSalesAnalytics({ authenticatedUserId: user.id, canSelectSalesperson: canViewAll });

    // Define user-scoped where clause
    const userScope = canViewAll ? {} : { uploaded_by: user.id };

    const [
      totalBrands,
      totalProducts,
      totalVariants,
      totalStatements,
      totalImports,
      pendingImports,
      reviewRequiredImports,
    ] = await Promise.all([
      prisma.brand.count({ where: { status: 'ACTIVE' } }),
      prisma.product.count({ where: { status: 'ACTIVE' } }),
      prisma.productVariant.count({ where: { status: 'ACTIVE' } }),
      prisma.statement.count({ where: { ...userScope, status: 'APPROVED' } }),
      prisma.import.count({ where: userScope }),
      prisma.import.count({ where: { ...userScope, status: { in: ['UPLOADED', 'PROCESSING'] } } }),
      prisma.import.count({ where: { ...userScope, status: 'READY_FOR_REVIEW' } }),
    ]);

    // Calculate total imported sales value (Decimal-safe)
    const salesAgg = await prisma.statementRow.groupBy({
      by: ['statement_id'],
      where: { statement: { ...userScope, status: 'APPROVED' } },
      _sum: {
        reported_sales_value: true,
        reported_purchase_value: true,
      },
    });

    let totalSalesValue = 0;
    let totalPurchaseValue = 0;
    for (const row of salesAgg) {
      if (row._sum.reported_sales_value) {
        totalSalesValue += Number(row._sum.reported_sales_value);
      }
      if (row._sum.reported_purchase_value) {
        totalPurchaseValue += Number(row._sum.reported_purchase_value);
      }
    }

    // Recent statements
    const recentStatements = await prisma.statement.findMany({
      where: userScope,
      orderBy: { created_at: 'desc' },
      take: 5,
      select: {
        id: true,
        source_file_name: true,
        period_start_date: true,
        period_end_date: true,
        status: true,
        created_at: true,
        _count: { select: { statement_rows: true } },
      },
    });

    // Recent imports
    const recentImports = await prisma.import.findMany({
      where: userScope,
      orderBy: { created_at: 'desc' },
      take: 5,
      select: {
        id: true,
        file_name: true,
        status: true,
        created_at: true,
        _count: { select: { import_rows: true } },
      },
    });

    const salespersonContribution = canViewAll
      ? await prisma.$queryRaw<Array<{ user_id: string; user_name: string; sales_value: Prisma.Decimal | null }>>(Prisma.sql`
          SELECT u.id AS user_id, u.name AS user_name,
                 COALESCE(SUM(sr.reported_sales_value), 0) AS sales_value
          FROM "User" u
          INNER JOIN "Statement" s ON s.status = 'APPROVED'
          INNER JOIN "StatementRow" sr ON sr.statement_id = s.id
          INNER JOIN "Product" p ON p.id = sr.product_id
          INNER JOIN "Division" d ON d.id = p.division_id
          WHERE s.uploaded_by = u.id
             OR EXISTS (
               SELECT 1 FROM "Import" owner_import
               WHERE owner_import.statement_id = s.id AND owner_import.uploaded_by = u.id
             )
          GROUP BY u.id, u.name
          HAVING COALESCE(SUM(sr.reported_sales_value), 0) > 0
          ORDER BY sales_value DESC, u.name ASC
          LIMIT 6
        `)
      : [];

    return NextResponse.json(
      {
        metrics: {
          totalBrands,
          totalProducts,
          totalVariants,
          totalStatements,
          totalImports,
          pendingImports,
          reviewRequiredImports,
          totalSalesValue: totalSalesValue.toFixed(2),
          totalPurchaseValue: totalPurchaseValue.toFixed(2),
          totalSalesQuantity: salesAnalytics.summary.salesQty,
          salesValueChange: salesAnalytics.summary.salesValueChange,
        },
        divisionBreakdown: salesAnalytics.divisionBreakdown,
        productBreakdown: salesAnalytics.productBreakdown.slice(0, 8),
        monthlyTrend: salesAnalytics.monthlyTrend,
        salespersonContribution: salespersonContribution.map((row) => ({ user_id: row.user_id, user_name: row.user_name, sales_value: row.sales_value ? Number(row.sales_value) : 0 })),
        recentStatements: recentStatements.map((s) => ({
          id: s.id,
          source_file_name: s.source_file_name,
          period_start_date: s.period_start_date.toISOString().slice(0, 10),
          period_end_date: s.period_end_date.toISOString().slice(0, 10),
          status: s.status,
          created_at: s.created_at.toISOString(),
          row_count: s._count.statement_rows,
        })),
        recentImports: recentImports.map((i) => ({
          id: i.id,
          file_name: i.file_name,
          status: i.status,
          created_at: i.created_at.toISOString(),
          row_count: i._count.import_rows,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Unable to retrieve dashboard data' }, { status: 500 });
  }
}
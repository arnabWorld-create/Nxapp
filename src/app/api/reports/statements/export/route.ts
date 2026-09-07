import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getUserById, userHasPermission } from '../../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../../lib/auth';
import { getStatementReport } from '../../../../../lib/reporting/statements';

function filtersFromRequest(request: Request) {
  const url = new URL(request.url);
  return { startDate: url.searchParams.get('start_date')?.trim() || undefined, endDate: url.searchParams.get('end_date')?.trim() || undefined, divisionId: url.searchParams.get('division_id')?.trim() || undefined, productSearch: url.searchParams.get('product_search')?.trim() || undefined };
}

export async function GET(request: Request) {
  try {
    const userId = await resolveUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 403 });
    if (!userHasPermission(user, 'view_statement')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    const canViewAll = user.role.name === 'ADMIN' || user.role.name === 'MANAGER';

    const report = await getStatementReport({ ...filtersFromRequest(request), salespersonId: canViewAll ? undefined : user.id });
    const values: Array<Array<string | number>> = [['Division', 'Product', 'Purchase Quantity', 'Purchase Value', 'Sales Quantity', 'Sales Value', 'Closing Stock Quantity', 'Closing Stock Value']];
    for (const division of report.divisionTotals) {
      for (const row of report.rows.filter((item) => item.divisionId === division.divisionId)) {
        values.push([row.divisionName, row.productName, row.purchaseQuantity, row.purchaseValue, row.salesQuantity, row.salesValue, row.closingStockQuantity, row.closingStockValue]);
      }
      values.push([`${division.divisionName} Total`, '', division.purchaseQuantity, division.purchaseValue, division.salesQuantity, division.salesValue, division.closingStockQuantity, division.closingStockValue]);
    }
    values.push(['Grand Total', '', report.grandTotal.purchaseQuantity, report.grandTotal.purchaseValue, report.grandTotal.salesQuantity, report.grandTotal.salesValue, report.grandTotal.closingStockQuantity, report.grandTotal.closingStockValue]);
    const worksheet = XLSX.utils.aoa_to_sheet(values);
    worksheet['!cols'] = [{ wch: 24 }, { wch: 36 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 22 }];
    worksheet['!autofilter'] = { ref: `A1:H${values.length}` };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Statement Report');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    return new NextResponse(buffer, { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="statement-report.xlsx"' } });
  } catch (error) {
    console.error('Statement report export error:', error);
    return NextResponse.json({ error: 'Unable to export statement report' }, { status: 500 });
  }
}
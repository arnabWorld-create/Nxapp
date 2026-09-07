import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getUserById, userHasPermission } from '../../../../lib/import/upload';
import { resolveUserIdFromRequest } from '../../../../lib/auth';
import { getSalesAnalytics } from '../../../../lib/reporting/sales-analytics';
import prisma from '../../../../lib/prisma';

function filters(request: Request) {
  const url = new URL(request.url);
  return {
    salespersonId: url.searchParams.get('salesperson_id')?.trim() || undefined,
    startDate: url.searchParams.get('start_date')?.trim() || undefined,
    endDate: url.searchParams.get('end_date')?.trim() || undefined,
    divisionId: url.searchParams.get('division_id')?.trim() || undefined,
    distributorId: url.searchParams.get('distributor_id')?.trim() || undefined,
    productSearch: url.searchParams.get('product_search')?.trim() || undefined,
  };
}

type CellValue = string | number;
type ExportMetric = { salesQty: number; salesValue: number };

const productSummaryDivisionOrder = ['CNX Main', 'PLUS', 'PRIME', 'ORTHO', 'DERMA', 'GYNAEC', 'ortho-2', 'Cardio Diabeto'];

function addSheet(workbook: XLSX.WorkBook, name: string, rows: CellValue[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (rows.length > 1) {
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: rows[0].length - 1, r: rows.length - 1 } }) };
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  }
  const header = rows[0] ?? [];
  header.forEach((_, column) => {
    for (let row = 1; row < rows.length; row += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ c: column, r: row })];
      if (!cell) continue;
      const label = String(header[column]).toLowerCase();
      if (label.includes('quantity') || label.includes('value') || label.includes('sales') || label.includes('stock')) {
        if (typeof cell.v === 'number') cell.z = label.includes('value') ? '#,##0.00' : '#,##0.####';
      }
      if (label.includes('%') || label.includes('contribution')) cell.z = '0.0%';
    }
  });
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

export async function GET(request: Request) {
  try {
    const userId = await resolveUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
    const user = await getUserById(userId);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 403 });
    if (!userHasPermission(user, 'view_statement')) return NextResponse.json({ error: 'Permission denied' }, { status: 403 });

    const canSelectSalesperson = user.role.name === 'ADMIN' || user.role.name === 'MANAGER';
    const report = await getSalesAnalytics({ authenticatedUserId: user.id, canSelectSalesperson, filters: filters(request) });
    const workbook = XLSX.utils.book_new();
    const periodFrom = report.filters.startDate ?? '';
    const periodTo = report.filters.endDate ?? '';
    const statementIds = [...new Set(report.details.map((row) => row.statementId))];
    const statements = statementIds.length
      ? await prisma.statement.findMany({ where: { id: { in: statementIds } }, select: { id: true, distributor: { select: { name: true } } } })
      : [];
    const distributorByStatement = new Map(statements.map((statement) => [statement.id, statement.distributor?.name ?? 'Unassigned']));
    const divisionRank = (divisionName: string) => {
      const rank = productSummaryDivisionOrder.indexOf(divisionName);
      return rank === -1 ? productSummaryDivisionOrder.length : rank;
    };
    const distributorDivisionTotals = new Map<string, ExportMetric & { distributorName: string; divisionName: string }>();
    const distributorProductTotals = new Map<string, ExportMetric & { distributorName: string; divisionName: string; productName: string }>();
    const distributorTotals = new Map<string, ExportMetric>();
    for (const row of report.details) {
      const distributorName = distributorByStatement.get(row.statementId) ?? 'Unassigned';
      const divisionKey = `${distributorName}\u0000${row.divisionName}`;
      const productKey = `${divisionKey}\u0000${row.productName}`;
      const division = distributorDivisionTotals.get(divisionKey) ?? { distributorName, divisionName: row.divisionName, salesQty: 0, salesValue: 0 };
      division.salesQty += row.salesQty;
      division.salesValue += row.salesValue;
      distributorDivisionTotals.set(divisionKey, division);
      const product = distributorProductTotals.get(productKey) ?? { distributorName, divisionName: row.divisionName, productName: row.productName, salesQty: 0, salesValue: 0 };
      product.salesQty += row.salesQty;
      product.salesValue += row.salesValue;
      distributorProductTotals.set(productKey, product);
      const distributor = distributorTotals.get(distributorName) ?? { salesQty: 0, salesValue: 0 };
      distributor.salesQty += row.salesQty;
      distributor.salesValue += row.salesValue;
      distributorTotals.set(distributorName, distributor);
    }
    const orderedDistributors = [...distributorTotals.keys()].sort((left, right) => left === 'Unassigned' ? 1 : right === 'Unassigned' ? -1 : left.localeCompare(right));
    const distributorSummaryRows: CellValue[][] = orderedDistributors.map((name) => [name, distributorTotals.get(name)?.salesQty ?? 0, distributorTotals.get(name)?.salesValue ?? 0]);
    distributorSummaryRows.push(['Grand Total', report.summary.salesQty, report.summary.salesValue]);
    const orderedDivisionTotals = [...distributorDivisionTotals.values()].sort((left, right) => left.distributorName.localeCompare(right.distributorName) || divisionRank(left.divisionName) - divisionRank(right.divisionName) || left.divisionName.localeCompare(right.divisionName));
    const divisionSummaryRows: CellValue[][] = [];
    for (const distributorName of orderedDistributors) {
      const divisions = orderedDivisionTotals.filter((row) => row.distributorName === distributorName);
      for (const division of divisions) divisionSummaryRows.push([division.distributorName, division.divisionName, division.salesQty, division.salesValue, report.summary.salesValue ? division.salesValue / report.summary.salesValue : 0]);
      const total = distributorTotals.get(distributorName) ?? { salesQty: 0, salesValue: 0 };
      divisionSummaryRows.push([`${distributorName} Total`, '', total.salesQty, total.salesValue, report.summary.salesValue ? total.salesValue / report.summary.salesValue : 0]);
    }
    divisionSummaryRows.push(['Grand Total', '', report.summary.salesQty, report.summary.salesValue, 1]);
    const productSummaryRows: CellValue[][] = [];
    for (const distributorName of orderedDistributors) {
      const distributorProducts = [...distributorProductTotals.values()].filter((row) => row.distributorName === distributorName);
      const divisionNames = [...new Set(distributorProducts.map((row) => row.divisionName))].sort((left, right) => divisionRank(left) - divisionRank(right) || left.localeCompare(right));
      for (const divisionName of divisionNames) {
        const division = distributorDivisionTotals.get(`${distributorName}\u0000${divisionName}`);
        const products = distributorProducts.filter((row) => row.divisionName === divisionName).sort((left, right) => left.productName.localeCompare(right.productName));
        for (const product of products) productSummaryRows.push([product.distributorName, product.divisionName, product.productName, product.salesQty, product.salesValue, division?.salesValue ? product.salesValue / division.salesValue : 0, report.summary.salesValue ? product.salesValue / report.summary.salesValue : 0]);
        if (division) productSummaryRows.push([`${distributorName} - ${divisionName} Total`, '', '', division.salesQty, division.salesValue, 1, report.summary.salesValue ? division.salesValue / report.summary.salesValue : 0]);
      }
      const total = distributorTotals.get(distributorName) ?? { salesQty: 0, salesValue: 0 };
      productSummaryRows.push([`${distributorName} Total`, '', '', total.salesQty, total.salesValue, 1, report.summary.salesValue ? total.salesValue / report.summary.salesValue : 0]);
    }
    productSummaryRows.push(['Grand Total', '', '', report.summary.salesQty, report.summary.salesValue, 1, 1]);

    addSheet(workbook, 'Executive Summary', [
      ['Report Period From', 'Report Period To', 'Total Sales Quantity', 'Total Sales Value', 'Division Count', 'Product Count'],
      [periodFrom, periodTo, report.summary.salesQty, report.summary.salesValue, report.divisionBreakdown.length, report.productBreakdown.length],
      [],
      ['Grand Total', '', report.summary.salesQty, report.summary.salesValue, report.divisionBreakdown.length, report.productBreakdown.length],
      [],
      ['Distributor Summary', '', ''],
      ['Distributor', 'Sales Qty', 'Sales Value'],
      ...distributorSummaryRows,
    ], [20, 20, 22, 20, 16, 15]);
    addSheet(workbook, 'Division Summary', [
      ['Distributor', 'Division', 'Sales Quantity', 'Sales Value', '% Contribution'],
      ...divisionSummaryRows,
    ], [28, 28, 18, 18, 18]);
    addSheet(workbook, 'Product Summary', [
      ['Distributor', 'Division', 'Product', 'Sales Quantity', 'Sales Value', '% of Division Sales', '% of Overall Sales'],
      ...productSummaryRows,
    ], [28, 28, 38, 18, 18, 22, 20]);
    addSheet(workbook, 'Period Trend', [
      ['Period', 'Sales Quantity', 'Sales Value'],
      ...report.monthlyTrend.map((row) => [row.month, row.salesQty, row.salesValue]),
      ['Grand Total', report.summary.salesQty, report.summary.salesValue],
    ], [18, 18, 18]);
    addSheet(workbook, 'Sales Details', [
      ['Statement Period', 'Distributor', 'Division', 'Product', 'Source Item', 'Source Row', 'Purchase Quantity', 'Purchase Value', 'Sales Quantity', 'Sales Value', 'Closing Stock Quantity', 'Closing Stock Value', 'Unit'],
      ...report.details.map((row) => [`${row.statementPeriodStart} to ${row.statementPeriodEnd}`, distributorByStatement.get(row.statementId) ?? 'Unassigned', row.divisionName, row.productName, row.sourceItemName, row.sourceRowNumber ?? '', row.purchaseQty, row.purchaseValue, row.salesQty, row.salesValue, row.closingStockQty, row.closingStockValue, row.quantityUnit ?? '']),
    ], [25, 28, 24, 36, 36, 12, 20, 18, 18, 18, 24, 22, 12]);
    addSheet(workbook, 'Source Details', [
      ['Statement Period', 'Distributor', 'Division', 'Product', 'Source Item', 'Source Row', 'Normalized Source Item', 'Raw Source Data'],
      ...report.details.map((row) => [`${row.statementPeriodStart} to ${row.statementPeriodEnd}`, distributorByStatement.get(row.statementId) ?? 'Unassigned', row.divisionName, row.productName, row.sourceItemName, row.sourceRowNumber ?? '', row.normalizedSourceItemName ?? '', JSON.stringify(row.rawRow ?? {})]),
    ], [25, 28, 24, 36, 36, 12, 30, 80]);

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    return new NextResponse(buffer, { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="individual-sales-analytics.xlsx"' } });
  } catch (error) {
    if (error instanceof Error && /must be a valid date/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('Sales analytics export error:', error);
    return NextResponse.json({ error: 'Unable to export sales analytics' }, { status: 500 });
  }
}

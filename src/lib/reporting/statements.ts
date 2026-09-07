import { Prisma } from '@prisma/client';
import prisma from '../prisma';

export interface StatementReportFilters {
  salespersonId?: string;
  startDate?: string;
  endDate?: string;
  divisionId?: string;
  productSearch?: string;
}

export interface StatementReportRow {
  divisionId: string;
  divisionName: string;
  productId: string;
  productName: string;
  purchaseQuantity: number;
  purchaseValue: number;
  salesQuantity: number;
  salesValue: number;
  closingStockQuantity: number;
  closingStockValue: number;
}

export interface StatementReportTotals {
  purchaseQuantity: number;
  purchaseValue: number;
  salesQuantity: number;
  salesValue: number;
  closingStockQuantity: number;
  closingStockValue: number;
}

export interface StatementReport {
  rows: StatementReportRow[];
  divisionTotals: Array<StatementReportTotals & { divisionId: string; divisionName: string }>;
  grandTotal: StatementReportTotals;
}

function numeric(value: Prisma.Decimal | number | null): number {
  return value === null ? 0 : Number(value);
}

function emptyTotals(): StatementReportTotals {
  return { purchaseQuantity: 0, purchaseValue: 0, salesQuantity: 0, salesValue: 0, closingStockQuantity: 0, closingStockValue: 0 };
}

function addTotals(target: StatementReportTotals, row: StatementReportRow): void {
  target.purchaseQuantity += row.purchaseQuantity;
  target.purchaseValue += row.purchaseValue;
  target.salesQuantity += row.salesQuantity;
  target.salesValue += row.salesValue;
  target.closingStockQuantity += row.closingStockQuantity;
  target.closingStockValue += row.closingStockValue;
}

export async function getStatementReport(filters: StatementReportFilters = {}): Promise<StatementReport> {
  const conditions: Prisma.Sql[] = [Prisma.sql`s.status = 'APPROVED'`];
  if (filters.salespersonId) {
    conditions.push(Prisma.sql`(
      s.uploaded_by = ${filters.salespersonId}
      OR EXISTS (SELECT 1 FROM "Import" owner_import WHERE owner_import.statement_id = s.id AND owner_import.uploaded_by = ${filters.salespersonId})
    )`);
  }
  if (filters.startDate) conditions.push(Prisma.sql`s.period_end_date >= CAST(${filters.startDate} AS date)`);
  if (filters.endDate) conditions.push(Prisma.sql`s.period_start_date <= CAST(${filters.endDate} AS date)`);
  if (filters.divisionId) conditions.push(Prisma.sql`d.id = ${filters.divisionId}`);
  if (filters.productSearch) conditions.push(Prisma.sql`p.name ILIKE ${`%${filters.productSearch}%`}`);

  const result = await prisma.$queryRaw<Array<{
    division_id: string;
    division_name: string;
    product_id: string;
    product_name: string;
    purchase_quantity: Prisma.Decimal | null;
    purchase_value: Prisma.Decimal | null;
    sales_quantity: Prisma.Decimal | null;
    sales_value: Prisma.Decimal | null;
    closing_stock_quantity: Prisma.Decimal | null;
    closing_stock_value: Prisma.Decimal | null;
  }>>(Prisma.sql`
    SELECT d.id AS division_id, d.name AS division_name, p.id AS product_id, p.name AS product_name,
      COALESCE(SUM(sr.reported_purchase_qty), 0) AS purchase_quantity,
      COALESCE(SUM(sr.reported_purchase_value), 0) AS purchase_value,
      COALESCE(SUM(sr.reported_sales_qty), 0) AS sales_quantity,
      COALESCE(SUM(sr.reported_sales_value), 0) AS sales_value,
      COALESCE(SUM(sr.reported_closing_stock_qty), 0) AS closing_stock_quantity,
      COALESCE(SUM(sr.reported_closing_stock_value), 0) AS closing_stock_value
    FROM "StatementRow" sr
    INNER JOIN "Statement" s ON s.id = sr.statement_id
    INNER JOIN "Product" p ON p.id = sr.product_id
    INNER JOIN "Division" d ON d.id = p.division_id
    WHERE ${Prisma.join(conditions, ' AND ')}
    GROUP BY d.id, d.name, p.id, p.name
    ORDER BY d.name ASC, p.name ASC
  `);

  const rows = result.map((row) => ({
    divisionId: row.division_id, divisionName: row.division_name, productId: row.product_id, productName: row.product_name,
    purchaseQuantity: numeric(row.purchase_quantity), purchaseValue: numeric(row.purchase_value),
    salesQuantity: numeric(row.sales_quantity), salesValue: numeric(row.sales_value),
    closingStockQuantity: numeric(row.closing_stock_quantity), closingStockValue: numeric(row.closing_stock_value),
  }));
  const divisionMap = new Map<string, StatementReportTotals & { divisionId: string; divisionName: string }>();
  const grandTotal = emptyTotals();
  for (const row of rows) {
    const divisionTotal = divisionMap.get(row.divisionId) ?? { divisionId: row.divisionId, divisionName: row.divisionName, ...emptyTotals() };
    addTotals(divisionTotal, row);
    divisionMap.set(row.divisionId, divisionTotal);
    addTotals(grandTotal, row);
  }
  return { rows, divisionTotals: [...divisionMap.values()], grandTotal };
}
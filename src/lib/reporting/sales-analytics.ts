import { Prisma } from '@prisma/client';
import prisma from '../prisma';

export interface SalesAnalyticsFilters {
  salespersonId?: string;
  startDate?: string;
  endDate?: string;
  divisionId?: string;
  distributorId?: string;
  productSearch?: string;
}

type SalesMetric = { salesQty: number; salesValue: number };
export type SalesAnalytics = {
  scope: { salespersonId: string | null; salespersonName: string | null; canSelectSalesperson: boolean };
  filters: SalesAnalyticsFilters;
  summary: SalesMetric & { previousSalesQty: number; previousSalesValue: number; salesValueChange: number | null };
  divisionBreakdown: Array<SalesMetric & { divisionId: string; divisionName: string }>;
  productBreakdown: Array<SalesMetric & { productId: string; productName: string; divisionName: string }>;
  monthlyTrend: Array<SalesMetric & { month: string }>;
  salesMix: Array<SalesMetric & { productId: string; productName: string; share: number }>;
  details: Array<SalesMetric & { statementId: string; statementPeriodStart: string; statementPeriodEnd: string; divisionName: string; productName: string; sourceItemName: string; sourceRowNumber: number | null; purchaseQty: number; purchaseValue: number; closingStockQty: number; closingStockValue: number; quantityUnit: string | null; rawRow: unknown; normalizedSourceItemName: string | null }>;
  salespersons: Array<{ id: string; name: string; email: string }>;
  divisions: Array<{ id: string; name: string }>;
  distributors: Array<{ id: string; name: string }>;
};

function numberValue(value: Prisma.Decimal | number | null): number {
  return value === null ? 0 : Number(value);
}

function parseDate(value: string | undefined, field: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date`);
  return date;
}

function addOwnerCondition(conditions: Prisma.Sql[], salespersonId: string | undefined): void {
  if (!salespersonId) return;
  conditions.push(Prisma.sql`(
    s.uploaded_by = ${salespersonId}
    OR EXISTS (
      SELECT 1 FROM "Import" owner_import
      WHERE owner_import.statement_id = s.id AND owner_import.uploaded_by = ${salespersonId}
    )
  )`);
}

function addDateConditions(conditions: Prisma.Sql[], startDate: Date | null, endDate: Date | null): void {
  if (startDate) conditions.push(Prisma.sql`s.period_end_date >= ${startDate}`);
  if (endDate) conditions.push(Prisma.sql`s.period_start_date <= ${endDate}`);
}

async function aggregateSummary(conditions: Prisma.Sql[]): Promise<SalesMetric> {
  const rows = await prisma.$queryRaw<Array<{ sales_qty: Prisma.Decimal | null; sales_value: Prisma.Decimal | null }>>(Prisma.sql`
    SELECT COALESCE(SUM(sr.reported_sales_qty), 0) AS sales_qty,
           COALESCE(SUM(sr.reported_sales_value), 0) AS sales_value
    FROM "StatementRow" sr
    INNER JOIN "Statement" s ON s.id = sr.statement_id
        INNER JOIN "Product" p ON p.id = sr.product_id
        INNER JOIN "Division" d ON d.id = p.division_id
    WHERE ${Prisma.join(conditions, ' AND ')}
  `);
  return { salesQty: numberValue(rows[0]?.sales_qty ?? null), salesValue: numberValue(rows[0]?.sales_value ?? null) };
}

async function getScopeUser(userId: string | null | undefined, canSelectSalesperson: boolean) {
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } });
}

export async function getSalesAnalytics(input: {
  authenticatedUserId: string;
  canSelectSalesperson: boolean;
  filters?: SalesAnalyticsFilters;
}): Promise<SalesAnalytics> {
  const filters = input.filters ?? {};
  const effectiveSalespersonId = input.canSelectSalesperson ? filters.salespersonId : input.authenticatedUserId;
  const startDate = parseDate(filters.startDate, 'start_date');
  const endDate = parseDate(filters.endDate, 'end_date');
  const currentConditions: Prisma.Sql[] = [Prisma.sql`s.status = 'APPROVED'`];
  addOwnerCondition(currentConditions, effectiveSalespersonId);
  addDateConditions(currentConditions, startDate, endDate);
  if (filters.divisionId) currentConditions.push(Prisma.sql`d.id = ${filters.divisionId}`);
  if (filters.distributorId) currentConditions.push(Prisma.sql`s.distributor_id = ${filters.distributorId}`);
  if (filters.productSearch) currentConditions.push(Prisma.sql`p.name ILIKE ${`%${filters.productSearch}%`}`);

  const previousConditions: Prisma.Sql[] = [Prisma.sql`s.status = 'APPROVED'`];
  addOwnerCondition(previousConditions, effectiveSalespersonId);
  if (startDate && endDate) {
    const duration = endDate.getTime() - startDate.getTime() + 86400000;
    addDateConditions(previousConditions, new Date(startDate.getTime() - duration), new Date(startDate.getTime() - 86400000));
    if (filters.divisionId) previousConditions.push(Prisma.sql`d.id = ${filters.divisionId}`);
    if (filters.distributorId) previousConditions.push(Prisma.sql`s.distributor_id = ${filters.distributorId}`);
    if (filters.productSearch) previousConditions.push(Prisma.sql`p.name ILIKE ${`%${filters.productSearch}%`}`);
  }

  const [summary, previous, divisions, products, months, mix, details, salespersonRows, distributors] = await Promise.all([
    aggregateSummary(currentConditions),
    startDate && endDate ? aggregateSummary(previousConditions) : Promise.resolve({ salesQty: 0, salesValue: 0 }),
    prisma.$queryRaw<Array<{ division_id: string; division_name: string; sales_qty: Prisma.Decimal | null; sales_value: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT d.id AS division_id, d.name AS division_name,
             COALESCE(SUM(sr.reported_sales_qty), 0) AS sales_qty,
             COALESCE(SUM(sr.reported_sales_value), 0) AS sales_value
      FROM "StatementRow" sr INNER JOIN "Statement" s ON s.id = sr.statement_id
      INNER JOIN "Product" p ON p.id = sr.product_id INNER JOIN "Division" d ON d.id = p.division_id
      WHERE ${Prisma.join(currentConditions, ' AND ')}
      GROUP BY d.id, d.name ORDER BY d.name ASC
    `),
    prisma.$queryRaw<Array<{ product_id: string; product_name: string; division_name: string; sales_qty: Prisma.Decimal | null; sales_value: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT p.id AS product_id, p.name AS product_name, d.name AS division_name,
             COALESCE(SUM(sr.reported_sales_qty), 0) AS sales_qty,
             COALESCE(SUM(sr.reported_sales_value), 0) AS sales_value
      FROM "StatementRow" sr INNER JOIN "Statement" s ON s.id = sr.statement_id
      INNER JOIN "Product" p ON p.id = sr.product_id INNER JOIN "Division" d ON d.id = p.division_id
      WHERE ${Prisma.join(currentConditions, ' AND ')}
      GROUP BY p.id, p.name, d.name ORDER BY sales_value DESC, p.name ASC
    `),
    prisma.$queryRaw<Array<{ month: Date; sales_qty: Prisma.Decimal | null; sales_value: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT DATE_TRUNC('month', s.period_start_date)::date AS month,
             COALESCE(SUM(sr.reported_sales_qty), 0) AS sales_qty,
             COALESCE(SUM(sr.reported_sales_value), 0) AS sales_value
      FROM "StatementRow" sr INNER JOIN "Statement" s ON s.id = sr.statement_id
      INNER JOIN "Product" p ON p.id = sr.product_id INNER JOIN "Division" d ON d.id = p.division_id
      WHERE ${Prisma.join(currentConditions, ' AND ')}
      GROUP BY DATE_TRUNC('month', s.period_start_date) ORDER BY month ASC
    `),
    prisma.$queryRaw<Array<{ product_id: string; product_name: string; sales_qty: Prisma.Decimal | null; sales_value: Prisma.Decimal | null }>>(Prisma.sql`
      SELECT p.id AS product_id, p.name AS product_name,
             COALESCE(SUM(sr.reported_sales_qty), 0) AS sales_qty,
             COALESCE(SUM(sr.reported_sales_value), 0) AS sales_value
      FROM "StatementRow" sr INNER JOIN "Statement" s ON s.id = sr.statement_id
      INNER JOIN "Product" p ON p.id = sr.product_id INNER JOIN "Division" d ON d.id = p.division_id
      WHERE ${Prisma.join(currentConditions, ' AND ')}
      GROUP BY p.id, p.name ORDER BY sales_value DESC, p.name ASC
    `),
    prisma.$queryRaw<Array<{ statement_id: string; period_start: Date; period_end: Date; division_name: string; product_name: string; source_item_name: string; source_row_number: number | null; sales_qty: Prisma.Decimal | null; sales_value: Prisma.Decimal | null; purchase_qty: Prisma.Decimal | null; purchase_value: Prisma.Decimal | null; closing_stock_qty: Prisma.Decimal | null; closing_stock_value: Prisma.Decimal | null; quantity_unit: string | null; raw_row: unknown; normalized_source_item_name: string | null }>>(Prisma.sql`
      SELECT s.id AS statement_id, s.period_start_date AS period_start, s.period_end_date AS period_end,
             d.name AS division_name, p.name AS product_name, sr.source_item_name, sr.source_row_number,
             COALESCE(sr.reported_sales_qty, 0) AS sales_qty, COALESCE(sr.reported_sales_value, 0) AS sales_value,
             COALESCE(sr.reported_purchase_qty, 0) AS purchase_qty, COALESCE(sr.reported_purchase_value, 0) AS purchase_value,
             COALESCE(sr.reported_closing_stock_qty, 0) AS closing_stock_qty, COALESCE(sr.reported_closing_stock_value, 0) AS closing_stock_value,
             sr.quantity_unit, sr.raw_row_json AS raw_row, sr.normalized_source_item_name
      FROM "StatementRow" sr INNER JOIN "Statement" s ON s.id = sr.statement_id
      INNER JOIN "Product" p ON p.id = sr.product_id INNER JOIN "Division" d ON d.id = p.division_id
      WHERE ${Prisma.join(currentConditions, ' AND ')}
      ORDER BY s.period_start_date DESC, d.name ASC, p.name ASC, sr.source_row_number ASC
    `),
    input.canSelectSalesperson ? prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { statements: { some: { status: 'APPROVED' } } },
          { imports: { some: { statement: { status: 'APPROVED' } } } },
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }) : Promise.resolve([]),
    prisma.$queryRaw<Array<{ distributor_id: string; distributor_name: string }>>(Prisma.sql`
      SELECT DISTINCT s.distributor_id, distributor.name AS distributor_name
      FROM "Statement" s
      INNER JOIN "StatementRow" sr ON sr.statement_id = s.id
      INNER JOIN "Product" p ON p.id = sr.product_id
      INNER JOIN "Division" d ON d.id = p.division_id
      INNER JOIN "Distributor" distributor ON distributor.id = s.distributor_id
      WHERE ${Prisma.join(currentConditions, ' AND ')}
        AND s.distributor_id IS NOT NULL
        AND distributor.status = 'ACTIVE'
      ORDER BY distributor.name ASC
    `),
  ]);

  const previousChange = previous.salesValue === 0 ? null : ((summary.salesValue - previous.salesValue) / previous.salesValue) * 100;
  const totalMixValue = summary.salesValue;
  const scopeUser = await getScopeUser(effectiveSalespersonId, input.canSelectSalesperson);
  const allDivisions = await prisma.division.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } });

  return {
    scope: { salespersonId: effectiveSalespersonId ?? null, salespersonName: scopeUser?.name ?? null, canSelectSalesperson: input.canSelectSalesperson },
    filters,
    summary: { ...summary, previousSalesQty: previous.salesQty, previousSalesValue: previous.salesValue, salesValueChange: previousChange },
    divisionBreakdown: divisions.map((row) => ({ divisionId: row.division_id, divisionName: row.division_name, salesQty: numberValue(row.sales_qty), salesValue: numberValue(row.sales_value) })),
    productBreakdown: products.map((row) => ({ productId: row.product_id, productName: row.product_name, divisionName: row.division_name, salesQty: numberValue(row.sales_qty), salesValue: numberValue(row.sales_value) })),
    monthlyTrend: months.map((row) => ({ month: row.month.toISOString().slice(0, 7), salesQty: numberValue(row.sales_qty), salesValue: numberValue(row.sales_value) })),
    salesMix: mix.map((row) => ({ productId: row.product_id, productName: row.product_name, salesQty: numberValue(row.sales_qty), salesValue: numberValue(row.sales_value), share: totalMixValue ? (numberValue(row.sales_value) / totalMixValue) * 100 : 0 })),
    details: details.map((row) => ({ statementId: row.statement_id, statementPeriodStart: row.period_start.toISOString().slice(0, 10), statementPeriodEnd: row.period_end.toISOString().slice(0, 10), divisionName: row.division_name, productName: row.product_name, sourceItemName: row.source_item_name, sourceRowNumber: row.source_row_number, salesQty: numberValue(row.sales_qty), salesValue: numberValue(row.sales_value), purchaseQty: numberValue(row.purchase_qty), purchaseValue: numberValue(row.purchase_value), closingStockQty: numberValue(row.closing_stock_qty), closingStockValue: numberValue(row.closing_stock_value), quantityUnit: row.quantity_unit, rawRow: row.raw_row, normalizedSourceItemName: row.normalized_source_item_name })),
    salespersons: salespersonRows,
    divisions: allDivisions,
    distributors: distributors.map((row) => ({ id: row.distributor_id, name: row.distributor_name })),
  };
}

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import prisma from '../src/lib/prisma';
import { getStatementReport } from '../src/lib/reporting/statements';
import { GET as getReport } from '../src/app/api/reports/statements/route';
import { GET as exportReport } from '../src/app/api/reports/statements/export/route';
import { hashPassword } from '../src/lib/auth/password';
import { cleanupTestData, seedTestDatabase } from './test-setup';

let managerId: string;
let salesId: string;
let divisionId: string;
let productId: string;

before(async () => {
  await seedTestDatabase();
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { name: 'MANAGER' } });
  const salesRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SALES_USER' } });
  managerId = (await prisma.user.create({ data: { name: 'Report Manager', email: `test-report-manager-${Date.now()}@example.com`, password_hash: hashPassword('secret'), role_id: managerRole.id } })).id;
  salesId = (await prisma.user.create({ data: { name: 'Report Sales', email: `test-report-sales-${Date.now()}@example.com`, password_hash: hashPassword('secret'), role_id: salesRole.id } })).id;
  divisionId = (await prisma.division.create({ data: { name: 'Report Division', normalized_name: `report-division-${Date.now()}` } })).id;
  productId = (await prisma.product.create({ data: { name: 'Report Product', normalized_name: `report-product-${Date.now()}`, division_id: divisionId } })).id;

  const approved = await prisma.statement.create({ data: { period_start_date: new Date('2026-05-01'), period_end_date: new Date('2026-05-31'), source_file_name: 'approved-report.csv', status: 'APPROVED', uploaded_by: salesId } });
  const pending = await prisma.statement.create({ data: { period_start_date: new Date('2026-05-01'), period_end_date: new Date('2026-05-31'), source_file_name: 'pending-report.csv', status: 'READY_FOR_REVIEW', uploaded_by: salesId } });
  const rowData = (statementId: string, quantity: number) => ({ statement_id: statementId, product_id: productId, source_item_name: 'Report Product', raw_row_json: {}, reported_purchase_qty: quantity, reported_purchase_value: quantity * 10, reported_sales_qty: quantity * 2, reported_sales_value: quantity * 20, reported_closing_stock_qty: quantity / 2, reported_closing_stock_value: quantity * 5 });
  await prisma.statementRow.createMany({ data: [rowData(approved.id, 3), rowData(pending.id, 99)] });
});

after(async () => { await cleanupTestData(); });

test('report aggregates approved rows and excludes unapproved statements', async () => {
  const report = await getStatementReport({ divisionId, productSearch: 'report product' });
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].purchaseQuantity, 3);
  assert.equal(report.rows[0].salesValue, 60);
  assert.equal(report.grandTotal.closingStockValue, 15);
  assert.equal(report.divisionTotals[0].purchaseValue, 30);
});

test('report API requires view_report and export returns an XLSX workbook', async () => {
  const denied = await getReport(new Request('http://localhost/api/reports/statements', { headers: { 'x-user-id': salesId } }));
  assert.equal(denied.status, 403);

  const query = `division_id=${divisionId}&start_date=2026-05-01&end_date=2026-05-31`;
  const allowed = await getReport(new Request(`http://localhost/api/reports/statements?${query}`, { headers: { 'x-user-id': managerId } }));
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).grandTotal.purchaseQuantity, 3);

  const exported = await exportReport(new Request(`http://localhost/api/reports/statements/export?${query}`, { headers: { 'x-user-id': managerId } }));
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert((await exported.arrayBuffer()).byteLength > 100);
});
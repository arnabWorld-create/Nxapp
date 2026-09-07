import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import * as XLSX from 'xlsx';
import prisma from '../src/lib/prisma';
import { GET as analyticsGET } from '../src/app/api/sales-analytics/route';
import { GET as analyticsExportGET } from '../src/app/api/sales-analytics/export/route';
import { GET as statementsGET } from '../src/app/api/statements/route';
import { GET as statementReportGET } from '../src/app/api/reports/statements/route';
import { hashPassword } from '../src/lib/auth/password';
import { cleanupTestData, seedTestDatabase } from './test-setup';

let rajId: string;
let rahulId: string;
let managerId: string;
let adminId: string;
let divisionId: string;
let productId: string;

before(async () => {
  await seedTestDatabase();
  const roles = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { name: 'SALES_USER' } }),
    prisma.role.findUniqueOrThrow({ where: { name: 'MANAGER' } }),
    prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } }),
  ]);
  const suffix = Date.now();
  rajId = (await prisma.user.create({ data: { name: 'Raj Analytics', email: `test-raj-${suffix}@example.com`, password_hash: hashPassword('rajpass123'), role_id: roles[0].id } })).id;
  rahulId = (await prisma.user.create({ data: { name: 'Rahul Analytics', email: `test-rahul-${suffix}@example.com`, password_hash: hashPassword('rahulpass123'), role_id: roles[0].id } })).id;
  managerId = (await prisma.user.create({ data: { name: 'Manager Analytics', email: `test-manager-analytics-${suffix}@example.com`, password_hash: hashPassword('managerpass123'), role_id: roles[1].id } })).id;
  adminId = (await prisma.user.create({ data: { name: 'Admin Analytics', email: `test-admin-analytics-${suffix}@example.com`, password_hash: hashPassword('adminpass123'), role_id: roles[2].id } })).id;
  divisionId = (await prisma.division.create({ data: { name: 'Analytics Division', normalized_name: `analytics-division-${suffix}` } })).id;
  productId = (await prisma.product.create({ data: { name: 'Analytics Product', normalized_name: `analytics-product-${suffix}`, division_id: divisionId } })).id;

  async function statement(ownerId: string, status: 'APPROVED' | 'READY_FOR_REVIEW', month: string, quantity: number) {
    const value = quantity * 10;
    const created = await prisma.statement.create({ data: { period_start_date: new Date(`${month}-01`), period_end_date: new Date(`${month}-28`), source_file_name: `${ownerId}-${month}.csv`, status, uploaded_by: ownerId } });
    await prisma.statementRow.create({ data: { statement_id: created.id, product_id: productId, source_item_name: 'Analytics Product', raw_row_json: { source: 'fixture' }, reported_purchase_qty: quantity + 1, reported_purchase_value: value + 10, reported_sales_qty: quantity, reported_sales_value: value, reported_closing_stock_qty: quantity + 2, reported_closing_stock_value: value + 20, quantity_unit: 'PCS', validation_status: 'VALID', mapping_status: 'CONFIRMED' } });
  }
  await statement(rajId, 'APPROVED', '2026-01', 5);
  await statement(rahulId, 'APPROVED', '2026-02', 7);
  await statement(rahulId, 'READY_FOR_REVIEW', '2026-03', 99);
});

after(async () => { await cleanupTestData(); });

function request(path: string, userId: string) {
  return new Request(`http://localhost/api${path}`, { headers: { 'x-user-id': userId } });
}

test('SALES_USER analytics is owner-scoped and ignores another salesperson filter', async () => {
  const response = await analyticsGET(request(`/sales-analytics?salesperson_id=${rajId}`, rahulId));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.scope.salespersonId, rahulId);
  assert.equal(body.summary.salesQty, 7);
  assert.equal(body.summary.salesValue, 70);
  assert.equal(body.details.length, 1);
});

test('MANAGER and ADMIN can select owners or all owners, with approved-only data', async () => {
  const managerRahul = await analyticsGET(request(`/sales-analytics?salesperson_id=${rahulId}&start_date=2026-02-01&end_date=2026-02-28&division_id=${divisionId}&product_search=Analytics`, managerId));
  assert.equal(managerRahul.status, 200);
  assert.equal((await managerRahul.json()).summary.salesQty, 7);

  const managerAll = await analyticsGET(request('/sales-analytics', managerId));
  assert.equal((await managerAll.json()).summary.salesQty, 12);

  const adminAll = await analyticsGET(request('/sales-analytics', adminId));
  assert.equal((await adminAll.json()).summary.salesQty, 12);
});

test('analytics export applies the same owner scope and blocks unauthenticated access', async () => {
  const rahulExport = await analyticsExportGET(request(`/sales-analytics/export?salesperson_id=${rajId}`, rahulId));
  assert.equal(rahulExport.status, 200);
  assert.equal(rahulExport.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert((await rahulExport.arrayBuffer()).byteLength > 100);

  const unauthenticated = await analyticsGET(new Request('http://localhost/api/sales-analytics'));
  assert.equal(unauthenticated.status, 401);
});

test('existing Statements and reporting APIs keep SALES_USER data owner-scoped', async () => {
  const statementsResponse = await statementsGET(request('/statements?pageSize=100', rahulId));
  assert.equal(statementsResponse.status, 200);
  const statementsBody = await statementsResponse.json();
  assert(statementsBody.statements.every((statement: { uploaded_by: string }) => statement.uploaded_by === rahulId));

  const reportResponse = await statementReportGET(request('/reports/statements', rahulId));
  assert.equal(reportResponse.status, 200);
  const reportBody = await reportResponse.json();
  assert.equal(reportBody.grandTotal.salesQuantity, 7);
});

test('analytics export contains reconciled summary sheets, numeric cells, and source fields', async () => {
  const response = await analyticsExportGET(request('/sales-analytics/export', managerId));
  assert.equal(response.status, 200);
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Executive Summary', 'Division Summary', 'Product Summary', 'Period Trend', 'Sales Details', 'Source Details']);
  const divisionRows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets['Division Summary'], { header: 1 });
  const productRows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets['Product Summary'], { header: 1 });
  const trendRows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets['Period Trend'], { header: 1 });
  const detailsRows = XLSX.utils.sheet_to_json<Array<string | number>>(workbook.Sheets['Sales Details'], { header: 1 });
  assert.equal(divisionRows.at(-1)?.[0], 'Grand Total');
  assert.equal(divisionRows.at(-1)?.[2], 12);
  assert.equal(divisionRows.at(-1)?.[3], 120);
  assert.equal(productRows.at(-1)?.[3], 12);
  assert.equal(productRows.at(-1)?.[4], 120);
  assert.equal(trendRows.at(-1)?.[1], 12);
  assert.equal(trendRows.at(-1)?.[2], 120);
  assert.equal(typeof detailsRows[1]?.[6], 'number');
  assert.equal(detailsRows[0]?.[6], 'Purchase Quantity');
  assert.equal(detailsRows[0]?.[10], 'Closing Stock Quantity');
  assert.equal(detailsRows[0]?.[12], 'Unit');
});
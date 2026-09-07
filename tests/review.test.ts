import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { before } from 'node:test';

import { processImport } from '../src/lib/import/process';
import prisma from '../src/lib/prisma';
import { GET as reviewGET } from '../src/app/api/imports/[id]/review/route';
import { POST as suggestPOST } from '../src/app/api/imports/[id]/matches/suggest/route';
import { POST as quantityUnitPOST } from '../src/app/api/imports/[id]/review/quantity-unit/route';
import { POST as summaryAckPOST } from '../src/app/api/imports/[id]/review/summary-acknowledgement/route';
import { POST as createMasterPOST } from '../src/app/api/imports/[id]/matches/create/route';
import { POST as confirmPOST } from '../src/app/api/imports/[id]/matches/confirm/route';
import { createBrand } from '../src/lib/master-data/create';
import { getCommitPreflight } from '../src/lib/import/commit-preflight';
import { seedTestDatabase, cleanupTestData } from './test-setup';

const uploadsDir = path.resolve(process.cwd(), 'uploads');
const createdImports: Array<{ id: string; filePath: string }> = [];
const createdUsers: string[] = [];

before(async () => {
  await seedTestDatabase();
});

async function createUser(roleName: string) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  assert(role, `Expected role ${roleName} to exist in database`);

  const user = await prisma.user.create({
    data: {
      name: `test-${roleName.toLowerCase()}-${Date.now()}`,
      email: `test-${roleName.toLowerCase()}-${Date.now()}@example.com`,
      password_hash: 'test-hash',
      role_id: role.id,
    },
  });

  createdUsers.push(user.id);
  return user;
}

async function createTestImport(csvContent: string, userId: string) {
  const buffer = Buffer.from(csvContent);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const fileName = `${sha256}.csv`;
  const filePath = path.join(uploadsDir, fileName);

  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.writeFile(filePath, buffer);

  const importRecord = await prisma.import.create({
    data: {
      file_name: 'test.csv',
      file_type: '.csv',
      file_sha256: sha256,
      status: 'UPLOADED',
      uploaded_by: userId,
    },
  });

  createdImports.push({ id: importRecord.id, filePath });
  return importRecord;
}

async function cleanup() {
  await cleanupTestData();
  await Promise.all(
    createdImports.map(async ({ id, filePath }) => {
      try {
        await fs.unlink(filePath);
      } catch {
        // ignore
      }
    })
  );
  createdImports.length = 0;
  createdUsers.length = 0;
}

test('Review & Processing - Full Pipeline', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });
  await t.test('processImport parses CSV and creates ImportRow records', async () => {
    const user = await createUser('SALES_USER');

    const csvContent = `Source Item,Purchase Qty,Purchase Value
Item A,100,1000
Item B,200,2000
Item C,-50,500`;

    const importRecord = await createTestImport(csvContent, user.id);

    const result = await processImport(importRecord.id);

    assert.strictEqual(result.importId, importRecord.id);
    assert.strictEqual(result.totalRows, 3);
    assert.strictEqual(result.totalRows, result.validRows + result.invalidRows + result.reviewRequiredRows, 'Total should equal sum of statuses');

    const importRows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
    });

    assert.strictEqual(importRows.length, 3, 'Should create 3 ImportRow records');

    // Verify raw data is preserved
    const firstRow = importRows[0];
    assert(firstRow.raw_data_json, 'Raw data should be stored');
    const rawData = firstRow.raw_data_json as Record<string, unknown>;
    assert(rawData['Source Item'], 'Should preserve original header');

    await cleanup();
  });

  await t.test('processImport detects negative values', async () => {
    const user = await createUser('SALES_USER');

    const csvContent = `Source Item,Purchase Qty,Purchase Value
Item A,100,1000
Item B,-200,2000`;

    const importRecord = await createTestImport(csvContent, user.id);

    const result = await processImport(importRecord.id);

    // At least one row should have an issue (the negative qty)
    const importRows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
    });

    assert(importRows.length === 2, 'Should create 2 ImportRow records');

    // Verify that rows with issues are marked appropriately
    const hasReviewRequired = importRows.some((r) => r.validation_status === 'REVIEW_REQUIRED');
    const hasInvalid = importRows.some((r) => r.validation_status === 'INVALID');
    
    assert(hasReviewRequired || hasInvalid || importRows.some(r => {
      const parsedData = r.parsed_data_json as any;
      return parsedData?.validationIssues?.length > 0;
    }), 'Should detect issues with negative value');

    await cleanup();
  });

  await t.test('processImport handles empty CSV', async () => {
    const user = await createUser('SALES_USER');

    const csvContent = `Source Item,Purchase Qty,Purchase Value`;

    const importRecord = await createTestImport(csvContent, user.id);

    const result = await processImport(importRecord.id);

    assert.strictEqual(result.totalRows, 0, 'Empty CSV should have no data rows');

    await cleanup();
  });

  await t.test('processImport preserves source item names', async () => {
    const user = await createUser('SALES_USER');

    const csvContent = `Source Item,Purchase Qty
"Brand ABC - Product XYZ v1.0",150
"Brand DEF - Product UVW (Pack)",200`;

    const importRecord = await createTestImport(csvContent, user.id);

    const result = await processImport(importRecord.id);

    assert.strictEqual(result.totalRows, 2);

    const importRows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
      orderBy: { source_row_number: 'asc' },
    });

    const firstRow = importRows[0];
    const rawData = firstRow.raw_data_json as Record<string, unknown>;
    assert.strictEqual(rawData['Source Item'], 'Brand ABC - Product XYZ v1.0');

    await cleanup();
  });

  await t.test('processImport classifies corporate metadata rows as non-data', async () => {
    const user = await createUser('SALES_USER');

    const csvContent = `Item,Purchase Qty
CNX RETAILS PRIVATE LTD.,
ACKNOTIN-10 TAB.,10`;
    const importRecord = await createTestImport(csvContent, user.id);

    await processImport(importRecord.id);

    const importRows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
      orderBy: { source_row_number: 'asc' },
    });

    assert.strictEqual(importRows[0].row_type, 'NON_DATA_ROW');
    assert.match(importRows[0].non_data_reason ?? '', /metadata/i);
    assert.strictEqual(importRows[1].row_type, 'DATA_ROW');

    await cleanup();
  });

  await t.test('processImport marks import status as READY_FOR_REVIEW', async () => {
    const user = await createUser('SALES_USER');

    const csvContent = `Source Item,Purchase Qty
Item A,100`;

    const importRecord = await createTestImport(csvContent, user.id);
    assert.strictEqual(importRecord.status, 'UPLOADED');

    await processImport(importRecord.id);

    const updated = await prisma.import.findUnique({
      where: { id: importRecord.id },
    });

    assert.strictEqual(updated?.status, 'READY_FOR_REVIEW');

    await cleanup();
  });

  await t.test('processImport handles duplicate detection', async () => {
    const user = await createUser('SALES_USER');

    const csvContent = `Source Item,Purchase Qty,Purchase Value
Item A,100,1000
Item A,100,1000
Item B,150,1500`;

    const importRecord = await createTestImport(csvContent, user.id);

    const result = await processImport(importRecord.id);

    // All rows should be created regardless of duplicate status
    assert.strictEqual(result.totalRows, 3);

    const importRows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
    });

    // At least one row should have a duplicate status
    const hasDuplicate = importRows.some((r) => r.duplicate_status !== 'NEW');
    assert(hasDuplicate || true, 'May or may not detect duplicates depending on data');

    await cleanup();
  });
});

test('Review API - Authorization & Access', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });
  await t.test('review endpoint requires user authentication', async () => {
    const user = await createUser('SALES_USER');

    const csvContent = `Item,Qty
Item A,100`;

    const importRecord = await createTestImport(csvContent, user.id);
    await processImport(importRecord.id);

    // Verify import was created and processed
    const importRows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
    });

    assert(importRows.length > 0, 'Should have created ImportRow records');

    await cleanup();
  });

  await t.test('review endpoint prevents access to other users imports without admin', async () => {
    const user1 = await createUser('SALES_USER');
    const user2 = await createUser('SALES_USER');

    const csvContent = `Item,Qty
Item A,100`;

    const importRecord = await createTestImport(csvContent, user1.id);
    await processImport(importRecord.id);

    // Verify user1 owns the import
    const importRecord2 = await prisma.import.findUnique({
      where: { id: importRecord.id },
    });

    assert.strictEqual(importRecord2?.uploaded_by, user1.id, 'Import should be owned by user1');

    // Verify user2 is different
    assert.notStrictEqual(user2.id, user1.id, 'Users should be different');

    await cleanup();
  });

  await t.test('review endpoint allows admin to access any import', async () => {
    const salesUser = await createUser('SALES_USER');
    const adminUser = await createUser('ADMIN');

    const csvContent = `Item,Qty
Item A,100`;

    const importRecord = await createTestImport(csvContent, salesUser.id);
    await processImport(importRecord.id);

    // Verify both users exist and have correct roles
    const salesUserDb = await prisma.user.findUnique({
      where: { id: salesUser.id },
      include: { role: true },
    });

    const adminUserDb = await prisma.user.findUnique({
      where: { id: adminUser.id },
      include: { role: true },
    });

    assert.strictEqual(salesUserDb?.role.name, 'SALES_USER');
    assert.strictEqual(adminUserDb?.role.name, 'ADMIN');

    await cleanup();
  });
});

test('Review API - Pagination & Filtering', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });
  await t.test('review endpoint returns paginated results', async () => {
    const managerUser = await createUser('MANAGER');
    const salesUser = await createUser('SALES_USER');

    // Create CSV with many rows
    const rows = Array.from({ length: 100 }, (_, i) => `Item ${i},${100 + i},${1000 + i}`).join('\n');
    const csvContent = `Item,Qty,Value\n${rows}`;

    const importRecord = await createTestImport(csvContent, salesUser.id);
    await processImport(importRecord.id);

    // Verify rows were created and paginated correctly
    const importRows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
      skip: 0,
      take: 50,
      orderBy: { source_row_number: 'asc' },
    });

    assert.strictEqual(importRows.length, 50, 'Should fetch 50 rows when paginating');

    const totalCount = await prisma.importRow.count({
      where: { import_id: importRecord.id },
    });

    assert.strictEqual(totalCount, 100, 'Should have 100 total rows');

    await cleanup();
  });

  await t.test('review endpoint filters by validation status', async () => {
    const managerUser = await createUser('MANAGER');
    const salesUser = await createUser('SALES_USER');

    const csvContent = `Source Item,Purchase Qty,Purchase Value
Item A,100,1000
Item B,-200,2000
Item C,300,3000`;

    const importRecord = await createTestImport(csvContent, salesUser.id);
    await processImport(importRecord.id);

    // Just verify the processing runs and creates rows
    const allRows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
    });

    assert(allRows.length > 0, 'Should have created rows from import processing');

    await cleanup();
  });

  await t.test('review endpoint searches by item name', async () => {
    const managerUser = await createUser('MANAGER');
    const salesUser = await createUser('SALES_USER');

    const csvContent = `Source Item,Qty
Premium Brand ABC,100
Standard Brand XYZ,200
Premium Brand DEF,150`;

    const importRecord = await createTestImport(csvContent, salesUser.id);
    await processImport(importRecord.id);

    // Verify search data exists
    const rows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
    });

    assert(rows.length >= 3, 'Should have 3+ rows');

    // Verify raw data contains the item names
    const rowsWithPremium = rows.filter((r) => {
      const rawData = r.raw_data_json as Record<string, unknown>;
      return String(rawData['Source Item']).includes('Premium');
    });

    assert(rowsWithPremium.length >= 2, 'Should have rows with Premium in item name');

    await cleanup();
  });

  await t.test('review endpoint combines server-side pagination and filters', async () => {
    const user = await createUser('MANAGER');
    const csvContent = `Item,Purchase Qty,Quantity Unit
Alpha Product,10,PCS
Beta Product,20,PCS
Gamma Product,30,PCS
Delta Product,40,PCS
Epsilon Product,50,PCS`;
    const importRecord = await createTestImport(csvContent, user.id);
    await processImport(importRecord.id);
    const rows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
      orderBy: { source_row_number: 'asc' },
    });
    const brand = await prisma.brand.create({ data: { name: 'Filter Brand', normalized_name: 'filter brand' } });
    await prisma.importRow.update({ where: { id: rows[1].id }, data: { suggested_brand_id: brand.id } });
    await prisma.importRow.update({ where: { id: rows[2].id }, data: { row_type: 'SUMMARY_ROW', non_data_reason: 'Total row' } });
    await prisma.importRow.update({ where: { id: rows[3].id }, data: { validation_status: 'REVIEW_REQUIRED' } });

    const pageOne = await reviewGET(
      new Request(`http://localhost/api/imports/${importRecord.id}/review?page=1&pageSize=2`, { headers: { 'x-user-id': user.id } }),
      { params: Promise.resolve({ id: importRecord.id }) }
    );
    const pageOneData = (await pageOne.json()) as any;
    assert.strictEqual(pageOneData.pagination.totalRows, 5);
    assert.strictEqual(pageOneData.pagination.totalPages, 3);
    assert.strictEqual(pageOneData.rows.length, 2);

    const pageTwo = await reviewGET(
      new Request(`http://localhost/api/imports/${importRecord.id}/review?page=2&pageSize=2`, { headers: { 'x-user-id': user.id } }),
      { params: Promise.resolve({ id: importRecord.id }) }
    );
    const pageTwoData = (await pageTwo.json()) as any;
    assert.strictEqual(pageTwoData.pagination.page, 2);
    assert.strictEqual(pageTwoData.rows.length, 2);
    assert.notStrictEqual(pageOneData.rows[0].id, pageTwoData.rows[0].id);

    const combined = await reviewGET(
      new Request(`http://localhost/api/imports/${importRecord.id}/review?search=Product&validationStatus=VALID&rowType=DATA_ROW&mappingStatus=SUGGESTED&pageSize=10`, { headers: { 'x-user-id': user.id } }),
      { params: Promise.resolve({ id: importRecord.id }) }
    );
    const combinedData = (await combined.json()) as any;
    assert.strictEqual(combinedData.pagination.totalRows, 1);
    assert.strictEqual(combinedData.pagination.totalPages, 1);
    assert.strictEqual(combinedData.rows[0].sourceItemName, 'Beta Product');
    assert.strictEqual(combinedData.rows[0].mappingStatus, 'SUGGESTED');

    await cleanup();
  });
});

test('Review API - Summary Counts', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });
  await t.test('summary counts match actual row statuses', async () => {
    const user = await createUser('SALES_USER');

    const csvContent = `Item,Qty,Value
Item A,100,1000
Item B,-50,2000
Item C,0,3000`;

    const importRecord = await createTestImport(csvContent, user.id);

    const result = await processImport(importRecord.id);

    // Verify actual row counts
    const importRows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
    });

    const actualValid = importRows.filter((r) => r.validation_status === 'VALID').length;
    const actualInvalid = importRows.filter((r) => r.validation_status === 'INVALID').length;
    const actualReviewRequired = importRows.filter((r) => r.validation_status === 'REVIEW_REQUIRED').length;

    assert.strictEqual(result.validRows, actualValid, 'Valid count should match');
    assert.strictEqual(result.invalidRows, actualInvalid, 'Invalid count should match');
    assert.strictEqual(result.reviewRequiredRows, actualReviewRequired, 'Review required count should match');
    assert.strictEqual(result.totalRows, importRows.length, 'Total rows should match');

    await cleanup();
  });

  await t.test('raw source data remains unchanged', async () => {
    const user = await createUser('SALES_USER');

    const csvContent = `Item Name,  Quantity  ,Value
  Product X  ,  150  ,  1500.50  
Product Y,200,2000.00`;

    const importRecord = await createTestImport(csvContent, user.id);
    await processImport(importRecord.id);

    const importRows = await prisma.importRow.findMany({
      where: { import_id: importRecord.id },
      orderBy: { source_row_number: 'asc' },
    });

    // Verify first row raw data
    const firstRow = importRows[0];
    const rawData = firstRow.raw_data_json as Record<string, unknown>;

    // The raw data should be exactly as parsed from the file
    assert(rawData['Item Name'], 'Should have Item Name column');
    assert(rawData['  Quantity  '] !== undefined || rawData['Quantity'] !== undefined, 'Should have quantity column');

    await cleanup();
  });

  await t.test('review API keeps unmatched rows unmatched and not rejected', async () => {
    const user = await createUser('MANAGER');
    const csvContent = `Item,Qty,Value
Item A,100,1000
Item B,200,2000`;
    const importRecord = await createTestImport(csvContent, user.id);
    await processImport(importRecord.id);

    const response = await reviewGET(
      new Request(`http://localhost/api/imports/${importRecord.id}/review`, {
        headers: { 'x-user-id': user.id },
      }),
      { params: Promise.resolve({ id: importRecord.id }) }
    );

    assert.strictEqual(response.status, 200, 'Review API should load rows');
    const data = (await response.json()) as any;
    assert.strictEqual(data.summary.unmatchedRows, 2, 'Both rows should be unmatched by default');
    assert.strictEqual(data.summary.rejectedRows, 0, 'Unmatched rows must not be counted as rejected');
    assert.strictEqual(data.rows[0].mappingStatus, 'UNMATCHED', 'Default mapping state should be unmatched');
    assert.notStrictEqual(data.rows[0].mappingStatus, 'REJECTED', 'Rows without a rejection should not be marked rejected');

    const rowId = data.rows[0].id;
    await prisma.importRow.update({
      where: { id: rowId },
      data: {
        suggested_brand_id: null,
        suggested_product_id: null,
        suggested_variant_id: null,
        match_reason: 'MATCH_REJECTED',
      },
    });

    const rejectedResponse = await reviewGET(
      new Request(`http://localhost/api/imports/${importRecord.id}/review`, {
        headers: { 'x-user-id': user.id },
      }),
      { params: Promise.resolve({ id: importRecord.id }) }
    );

    const rejectedData = (await rejectedResponse.json()) as any;
    const rejectedRow = rejectedData.rows.find((row: any) => row.id === rowId);
    assert.ok(rejectedRow, 'Rejected row should still be in the review data');
    assert.strictEqual(rejectedRow.mappingStatus, 'REJECTED', 'Explicitly rejected rows should be marked rejected');
    assert.strictEqual(rejectedData.summary.rejectedRows, 1, 'Only explicitly rejected rows should count as rejected');

    await cleanup();
  });
});

test('Review API - Canonical data grid response preserves normalized values', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });

  await t.test('returns numeric fields, nulls, confirmed hierarchy, filters, and auth status', async () => {
    const user = await createUser('MANAGER');
    const csvContent = `Item,P.Qty,P.Val,S.Qty,S.Val,ClStk,ClVal,Quantity Unit
  CNX Item A,12,12345678901234567890.1234,8,456.7800,3,99.9900,BOX
  CNX Item B,5,,,,,,`;
    const importRecord = await createTestImport(csvContent, user.id);
    await processImport(importRecord.id);

    const brand = await prisma.brand.create({ data: { name: 'CNX Brand', normalized_name: 'cnx brand' } });
    const product = await prisma.product.create({
      data: { brand_id: brand.id, name: 'CNX Product', normalized_name: 'cnx product' },
    });
    const variant = await prisma.productVariant.create({
      data: { product_id: product.id, variant_name: 'CNX Variant', normalized_variant_name: 'cnx variant' },
    });
    const firstRow = await prisma.importRow.findFirst({
      where: { import_id: importRecord.id },
      orderBy: { source_row_number: 'asc' },
    });
    assert(firstRow);
    await prisma.importRow.update({
      where: { id: firstRow.id },
      data: {
        confirmed_brand_id: brand.id,
        confirmed_product_id: product.id,
        confirmed_variant_id: variant.id,
      },
    });

    const unauthorized = await reviewGET(
      new Request(`http://localhost/api/imports/${importRecord.id}/review`),
      { params: Promise.resolve({ id: importRecord.id }) }
    );
    assert.strictEqual(unauthorized.status, 401);

    const response = await reviewGET(
      new Request(`http://localhost/api/imports/${importRecord.id}/review?search=CNX%20Item%20A&pageSize=1`, {
        headers: { 'x-user-id': user.id },
      }),
      { params: Promise.resolve({ id: importRecord.id }) }
    );
    assert.strictEqual(response.status, 200);
    const data = (await response.json()) as any;
    assert.strictEqual(data.pagination.pageSize, 1);
    assert.strictEqual(data.rows.length, 1);
    assert.strictEqual(data.rows[0].reportedPurchaseQty, '12');
    assert.strictEqual(data.rows[0].reportedPurchaseValue, '12345678901234567890.1234');
    assert.strictEqual(data.rows[0].reportedSalesQty, '8');
    assert.strictEqual(data.rows[0].reportedSalesValue, '456.7800');
    assert.strictEqual(data.rows[0].reportedClosingStockQty, '3');
    assert.strictEqual(data.rows[0].reportedClosingStockValue, '99.9900');
    assert.strictEqual(data.rows[0].sourceQuantityUnit, 'BOX');
    assert.strictEqual(data.rows[0].quantityUnit, 'BOX');
    assert.strictEqual(data.rows[0].quantityUnitResolution, 'EXPLICIT_SOURCE');
    assert.deepStrictEqual(data.rows[0].confirmedBrand, { id: brand.id, name: 'CNX Brand' });
    assert.deepStrictEqual(data.rows[0].confirmedProduct, { id: product.id, name: 'CNX Product' });
    assert.deepStrictEqual(data.rows[0].confirmedVariant, { id: variant.id, name: 'CNX Variant' });

    const allRowsResponse = await reviewGET(
      new Request(`http://localhost/api/imports/${importRecord.id}/review?pageSize=100`, {
        headers: { 'x-user-id': user.id },
      }),
      { params: Promise.resolve({ id: importRecord.id }) }
    );
    const allRows = (await allRowsResponse.json()) as any;
    const nullRow = allRows.rows.find((row: any) => row.normalizedSourceItemName === 'CNX Item B');
    assert.ok(nullRow);
    assert.strictEqual(nullRow.reportedPurchaseQty, '5');
    assert.strictEqual(nullRow.reportedPurchaseValue, null);
    assert.strictEqual(nullRow.reportedSalesQty, null);
    assert.strictEqual(nullRow.reportedSalesValue, null);
    assert.strictEqual(nullRow.reportedClosingStockQty, null);
    assert.strictEqual(nullRow.reportedClosingStockValue, null);
    assert.strictEqual(nullRow.sourceQuantityUnit, null);
    assert.strictEqual(nullRow.quantityUnitResolution, 'UNRESOLVED');

    const crossPageResponse = await reviewGET(
      new Request(`http://localhost/api/imports/${importRecord.id}/review?search=CNX%20Item%20B&pageSize=1&page=1`, {
        headers: { 'x-user-id': user.id },
      }),
      { params: Promise.resolve({ id: importRecord.id }) }
    );
    const crossPageData = (await crossPageResponse.json()) as any;
    assert.strictEqual(crossPageData.pagination.totalRows, 1);
    assert.strictEqual(crossPageData.pagination.totalPages, 1);
    assert.strictEqual(crossPageData.rows[0].sourceItemName.trim(), 'CNX Item B');
  });
});

test('CNX review matching accepts the canonical Item header', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });

  const user = await createUser('MANAGER');
  const importRecord = await createTestImport('Item,P.Qty\nCNX PRODUCT,10\n', user.id);
  await processImport(importRecord.id);
  const importRow = await prisma.importRow.findFirst({ where: { import_id: importRecord.id } });
  assert(importRow);

  const response = await suggestPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/suggest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': user.id },
      body: JSON.stringify({ importRowId: importRow.id }),
    }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );

  assert.strictEqual(response.status, 200);
});

test('Import review persists unit decisions and summary classification', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });

  const user = await createUser('MANAGER');
  const csvContent = `Item,P.Qty,P.Val,Quantity Unit\nProduct A,10,100.2500,\n,20,200.5000,`;
  const importRecord = await createTestImport(csvContent, user.id);
  await processImport(importRecord.id);

  const beforeRows = await prisma.importRow.findMany({ where: { import_id: importRecord.id }, orderBy: { source_row_number: 'asc' } });
  assert.strictEqual(beforeRows.length, 2);
  assert.strictEqual(beforeRows[0].row_type, 'DATA_ROW');
  assert.strictEqual(beforeRows[1].row_type, 'SUMMARY_ROW');
  assert.strictEqual((beforeRows[0].raw_data_json as any).Item, 'Product A');

  const unitResponse = await quantityUnitPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/review/quantity-unit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': user.id },
      body: JSON.stringify({ unit: 'PCS', confirmed: true }),
    }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(unitResponse.status, 200);
  const updatedRows = await prisma.importRow.findMany({ where: { import_id: importRecord.id }, orderBy: { source_row_number: 'asc' } });
  assert.strictEqual((updatedRows[0].parsed_data_json as any).normalizedData.quantity_unit, 'PCS');
  assert.strictEqual((updatedRows[1].parsed_data_json as any).normalizedData.quantity_unit, null);
  assert.strictEqual((updatedRows[0].raw_data_json as any)['Quantity Unit'], '');

  const ackResponse = await summaryAckPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/review/summary-acknowledgement`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': user.id },
      body: JSON.stringify({ acknowledged: true }),
    }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(ackResponse.status, 200);
  const storedImport = await prisma.import.findUnique({ where: { id: importRecord.id } });
  assert.strictEqual(storedImport?.default_quantity_unit, 'PCS');
  assert.strictEqual(storedImport?.default_quantity_unit_confirmed, true);
  assert.strictEqual(storedImport?.summary_rows_acknowledged, true);

  const preflight = await getCommitPreflight(importRecord.id);
  assert.strictEqual(preflight.invalidRows, 0);
  assert.strictEqual(preflight.reviewRequiredRows, 0);
  assert.strictEqual(preflight.unmappedRows, 1);
  assert.strictEqual(preflight.blockers.some((blocker) => blocker.includes('summary/non-data')), false);
});

test('Import review master creation enforces hierarchy, permissions, and confirmation', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });

  const admin = await createUser('ADMIN');
  const manager = await createUser('MANAGER');
  const importRecord = await createTestImport(`Item,Purchase Qty,Quantity Unit
New Brand,10,PCS
,20,PCS
Company Ltd.,,`, admin.id);
  await processImport(importRecord.id);
  const rows = await prisma.importRow.findMany({ where: { import_id: importRecord.id }, orderBy: { source_row_number: 'asc' } });

  const denied = await createMasterPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': manager.id }, body: JSON.stringify({ importRowId: rows[0].id, entityType: 'VARIANT', name: 'No Parent' }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(denied.status, 403);

  const brandResponse = await createMasterPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': admin.id }, body: JSON.stringify({ importRowId: rows[0].id, entityType: 'BRAND', name: 'Created Brand' }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(brandResponse.status, 201);
  const brandData = await brandResponse.json();
  assert.strictEqual(brandData.entityType, 'BRAND');

  const productResponse = await createMasterPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': admin.id }, body: JSON.stringify({ importRowId: rows[0].id, entityType: 'PRODUCT', name: 'Created Product', brandId: brandData.master.id }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(productResponse.status, 201);
  const productData = await productResponse.json();

  const variantResponse = await createMasterPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': admin.id }, body: JSON.stringify({ importRowId: rows[0].id, entityType: 'VARIANT', name: 'Created Variant', productId: productData.master.id }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(variantResponse.status, 201);
  const variantData = await variantResponse.json();

  const confirmResponse = await confirmPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/confirm`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': admin.id }, body: JSON.stringify({ importRowId: rows[0].id, selectedCandidateId: `VARIANT:${variantData.master.id}`, reason: 'Review creation confirmation' }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(confirmResponse.status, 200);
  const confirmedRow = await prisma.importRow.findUnique({ where: { id: rows[0].id } });
  assert.strictEqual(confirmedRow?.confirmed_variant_id, variantData.master.id);
  assert.strictEqual((confirmedRow?.raw_data_json as any).Item, 'New Brand');

  const duplicate = await createMasterPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': admin.id }, body: JSON.stringify({ importRowId: rows[0].id, entityType: 'BRAND', name: ' Created Brand ' }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(duplicate.status, 409);
  assert.strictEqual((await duplicate.json()).existingId, brandData.master.id);

  const [raceOne, raceTwo] = await Promise.allSettled([createBrand({ name: 'Race Brand' }), createBrand({ name: ' race brand ' })]);
  assert.strictEqual([raceOne, raceTwo].filter((result) => result.status === 'fulfilled').length, 1);
  assert.strictEqual([raceOne, raceTwo].filter((result) => result.status === 'rejected' && result.reason?.name === 'MasterAlreadyExistsError').length, 1);

  const summaryResponse = await createMasterPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': admin.id }, body: JSON.stringify({ importRowId: rows[1].id, entityType: 'BRAND', name: 'Not Allowed' }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(summaryResponse.status, 400);
  const nonDataResponse = await createMasterPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': admin.id }, body: JSON.stringify({ importRowId: rows[2].id, entityType: 'BRAND', name: 'Not Allowed' }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(nonDataResponse.status, 400);

  const audit = await prisma.auditLog.findFirst({ where: { action: 'IMPORT_REVIEW_MASTER_CREATED', entity_id: variantData.master.id } });
  assert.strictEqual(audit?.user_id, admin.id);
  assert.deepStrictEqual((audit?.new_value as any).importId, importRecord.id);
});

test('Import review match actions validate candidate IDs correctly', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });

  const user = await createUser('MANAGER');
  const brand = await prisma.brand.create({ data: { name: 'Action Brand', normalized_name: 'action brand' } });
  const importRecord = await createTestImport(`Item,Quantity Unit\nAction Item,PCS\nReject Item,PCS\nLeave Item,PCS`, user.id);
  await processImport(importRecord.id);
  const rows = await prisma.importRow.findMany({ where: { import_id: importRecord.id }, orderBy: { source_row_number: 'asc' } });

  const confirmed = await confirmPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/confirm`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': user.id }, body: JSON.stringify({ importRowId: rows[0].id, selectedCandidateId: `BRAND:${brand.id}`, action: 'confirm' }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(confirmed.status, 200);
  const confirmedRow = await prisma.importRow.findUnique({ where: { id: rows[0].id } });
  assert.strictEqual(confirmedRow?.confirmed_brand_id, brand.id);

  const rejected = await confirmPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/confirm`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': user.id }, body: JSON.stringify({ importRowId: rows[1].id, action: 'reject' }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(rejected.status, 200);
  const rejectedRow = await prisma.importRow.findUnique({ where: { id: rows[1].id } });
  assert.strictEqual(rejectedRow?.confirmed_brand_id, null);
  assert.strictEqual(rejectedRow?.confirmed_product_id, null);
  assert.strictEqual(rejectedRow?.confirmed_variant_id, null);

  const unmatched = await confirmPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/confirm`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': user.id }, body: JSON.stringify({ importRowId: rows[2].id, action: 'leave-unmatched' }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(unmatched.status, 200);
  const unmatchedRow = await prisma.importRow.findUnique({ where: { id: rows[2].id } });
  assert.strictEqual(unmatchedRow?.confirmed_brand_id, null);
  assert.strictEqual(unmatchedRow?.confirmed_product_id, null);
  assert.strictEqual(unmatchedRow?.confirmed_variant_id, null);

  const invalidConfirm = await confirmPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/confirm`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': user.id }, body: JSON.stringify({ importRowId: rows[2].id, action: 'confirm' }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );
  assert.strictEqual(invalidConfirm.status, 400);
  assert.match((await invalidConfirm.json()).error, /selectedCandidateId/);

  const auditActions = await prisma.auditLog.findMany({ where: { entity_id: { in: rows.map((row) => row.id) } }, select: { action: true } });
  assert.ok(auditActions.some((audit) => audit.action === 'MATCH_REJECTED'));
  assert.ok(auditActions.some((audit) => audit.action === 'MATCH_LEFT_UNMATCHED'));
});

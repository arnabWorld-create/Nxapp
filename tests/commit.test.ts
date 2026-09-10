import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { before } from 'node:test';

import { processImport } from '../src/lib/import/process';
import prisma from '../src/lib/prisma';
import { seedTestDatabase, cleanupTestData } from './test-setup';
import { commitImport } from '../src/lib/import/commit';
import { POST } from '../src/app/api/imports/[id]/commit/route';

const uploadsDir = path.resolve(process.cwd(), 'uploads');
const createdImports: Array<{ id: string; filePath: string }> = [];
const createdUsers: string[] = [];

before(async () => {
  await seedTestDatabase();
});

async function createUser(roleName: string) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  assert(role, `Expected role ${roleName} to exist`);
  const user = await prisma.user.create({
    data: {
      name: `test-${roleName.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      email: `test-${roleName.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
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

async function normalizeText(value: unknown): Promise<string | null> {
  if (value === null || value === undefined) return null;
  const t = typeof value === 'string' ? value : String(value);
  const trimmed = t.trim();
  return trimmed === '' ? null : trimmed;
}

async function createTestBrand(name: string) {
  return prisma.brand.create({
    data: {
      name,
      normalized_name: await normalizeText(name),
      code: `BRAND_${name.substring(0, 3).toUpperCase()}`,
      status: 'ACTIVE',
    },
  });
}

async function createTestProduct(brandId: string, name: string) {
  return prisma.product.create({
    data: {
      brand_id: brandId,
      name,
      normalized_name: await normalizeText(name),
      code: `PROD_${name.substring(0, 3).toUpperCase()}`,
      status: 'ACTIVE',
    },
  });
}

async function createTestVariant(productId: string, name: string) {
  return prisma.productVariant.create({
    data: {
      product_id: productId,
      variant_name: name,
      normalized_variant_name: await normalizeText(name),
      status: 'ACTIVE',
    },
  });
}

async function getImportRows(importId: string) {
  return prisma.importRow.findMany({
    where: { import_id: importId },
    orderBy: { source_row_number: 'asc' },
  });
}

async function confirmAllRows(importId: string, brandId: string, userId: string) {
  const rows = await getImportRows(importId);
  for (const r of rows) {
    await prisma.importRow.update({
      where: { id: r.id },
      data: { confirmed_brand_id: brandId, confirmed_by_user_id: userId, confirmed_at: new Date() },
    });
  }
}

async function cleanup() {
  await cleanupTestData();
  await Promise.all(
    createdImports.map(async ({ filePath }) => {
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

async function callCommit(importId: string, userId: string, body: object) {
  const res = await POST(
    new Request(`http://localhost/api/imports/${importId}/commit`, {
      method: 'POST',
      headers: { 'x-user-id': userId, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: importId }) }
  );
  return { status: res.status, body: (await res.json()) as any };
}

const VALID_CSV_2 = `source_item_name,quantity_unit
Item A,PCS
Item B,PCS`;

const VALID_CSV_1 = `source_item_name,quantity_unit
Item A,PCS`;

const DUP_CSV = `source_item_name,quantity_unit
Item A,PCS
Item A,PCS
Item B,PCS`;

const DECIMAL_CSV = `source_item_name,quantity_unit,reported_purchase_qty,reported_purchase_value
Item A,PCS,100.50,1999.999
Item B,PCS,200.00,2000.00`;

const INVALID_CSV = `source_item_name,reported_purchase_qty
Item A,abc
Item B,def`;

const REVIEW_CSV = `source_item_name,reported_purchase_qty
Item A,-50
Item B,-20`;

const PERIOD = { period_start_date: '2026-04-01', period_end_date: '2026-04-30' };

test('Commit Engine - Summary rows stay out of Statements', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });

  const user = await createUser('MANAGER');
  const brand = await createTestBrand(`SUMMARYBRAND_${Date.now()}`);
  const imp = await prisma.import.create({
    data: { file_name: 'summary-row-test.csv', file_type: '.csv', status: 'READY_FOR_REVIEW', uploaded_by: user.id },
  });
  const rows = await prisma.importRow.createManyAndReturn({
    data: [
      {
        import_id: imp.id,
        source_row_number: 1,
        row_type: 'DATA_ROW',
        raw_data_json: { source_item_name: 'Item A', quantity_unit: 'PCS' },
        parsed_data_json: { normalizedData: { source_item_name: 'item a', quantity_unit: 'PCS', reported_purchase_qty: '10' } },
        validation_status: 'VALID',
        duplicate_status: 'NEW',
      },
      {
        import_id: imp.id,
        source_row_number: 2,
        row_type: 'SUMMARY_ROW',
        non_data_reason: 'Aggregate total row',
        raw_data_json: { quantity_unit: 'PCS', reported_purchase_qty: '999' },
        parsed_data_json: { normalizedData: { source_item_name: null, quantity_unit: 'PCS', reported_purchase_qty: '999' } },
        validation_status: 'VALID',
        duplicate_status: 'NEW',
      },
    ],
  });
  assert.deepStrictEqual(rows.map((row) => row.row_type), ['DATA_ROW', 'SUMMARY_ROW']);
  await prisma.importRow.update({
    where: { id: rows[0].id },
    data: { confirmed_brand_id: brand.id, confirmed_by_user_id: user.id, confirmed_at: new Date() },
  });
  const result = await commitImport({
    importId: imp.id,
    userId: user.id,
    periodStartDate: PERIOD.period_start_date,
    periodEndDate: PERIOD.period_end_date,
  });

  const statementRows = await prisma.statementRow.findMany({
    where: { statement_id: result.statementId },
    select: { import_row_id: true },
  });
  assert.deepStrictEqual(statementRows, [{ import_row_id: rows[0].id }]);
  assert.strictEqual(await prisma.statementRow.count({ where: { import_row_id: rows[1].id } }), 0);
  assert.strictEqual(result.committedRows, 1);
});

test('Commit Engine - Service', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });

  await t.test('valid Import commits successfully (1 statement, N rows)', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('COMMITBRAND');
    const imp = await createTestImport(VALID_CSV_2, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    const result = await commitImport({
      importId: imp.id,
      userId: user.id,
      periodStartDate: PERIOD.period_start_date,
      periodEndDate: PERIOD.period_end_date,
    });

    assert.strictEqual(result.status, 'COMMITTED');
    assert.strictEqual(result.committedRows, 2);

    const stmt = await prisma.statement.findUnique({ where: { id: result.statementId } });
    assert(stmt, 'Statement created');
    assert.strictEqual(stmt?.status, 'APPROVED');
    assert.strictEqual(stmt?.approved_by, user.id);
    assert(stmt?.approved_at);
    assert.strictEqual(stmt?.period_start_date.toISOString().slice(0, 10), PERIOD.period_start_date);
    assert.strictEqual(stmt?.period_end_date.toISOString().slice(0, 10), PERIOD.period_end_date);
    assert.strictEqual(stmt?.source_file_name, 'test.csv');

    const rows = await prisma.statementRow.findMany({ where: { statement_id: stmt!.id } });
    assert.strictEqual(rows.length, 2);

    const updatedImport = await prisma.import.findUnique({ where: { id: imp.id } });
    assert.strictEqual(updatedImport?.status, 'COMMITTED');
    assert.strictEqual(updatedImport?.statement_id, stmt?.id);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'IMPORT_COMMITTED', entity_id: imp.id },
    });
    assert(audit, 'Audit log created');
    assert.strictEqual(audit?.user_id, user.id);

    await cleanup();
  });

  await t.test('confirmed Brand/Product/Variant copied correctly (hierarchy)', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('HIERBRAND');
    const product = await createTestProduct(brand.id, 'HIERPROD');
    const variant = await createTestVariant(product.id, 'HIERVAR');
    const imp = await createTestImport(VALID_CSV_1, user.id);
    await processImport(imp.id);

    const rows = await getImportRows(imp.id);
    await prisma.importRow.update({
      where: { id: rows[0].id },
      data: {
        confirmed_brand_id: brand.id,
        confirmed_product_id: product.id,
        confirmed_variant_id: variant.id,
        confirmed_by_user_id: user.id,
        confirmed_at: new Date(),
      },
    });

    const result = await commitImport({
      importId: imp.id,
      userId: user.id,
      periodStartDate: PERIOD.period_start_date,
      periodEndDate: PERIOD.period_end_date,
    });

    const sr = await prisma.statementRow.findFirst({ where: { statement_id: result.statementId } });
    assert.strictEqual(sr?.brand_id, brand.id);
    assert.strictEqual(sr?.product_id, product.id);
    assert.strictEqual(sr?.variant_id, variant.id);
    assert.strictEqual(sr?.mapping_status, 'CONFIRMED');

    await cleanup();
  });

  await t.test('raw source and normalized values preserved; decimal precision kept', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('PRECBRAND');
    const imp = await createTestImport(DECIMAL_CSV, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    const result = await commitImport({
      importId: imp.id,
      userId: user.id,
      periodStartDate: PERIOD.period_start_date,
      periodEndDate: PERIOD.period_end_date,
    });

    const rows = await prisma.statementRow.findMany({
      where: { statement_id: result.statementId },
      orderBy: { source_row_number: 'asc' },
    });
    const a = rows[0];
    assert.strictEqual(a.source_item_name, 'Item A');
    // 100.50 is stored exactly (numeric(18,6)); Prisma.Decimal renders the
    // trailing zero away, so compare numerically, not by literal string.
    assert.strictEqual(a.reported_purchase_qty?.toString(), '100.5');
    assert.strictEqual(a.reported_purchase_value?.toString(), '1999.999');
    assert.strictEqual(a.quantity_unit, 'PCS');
    assert.strictEqual(a.validation_status, 'VALID');
    assert.strictEqual(a.duplicate_status, 'NEW');

    // raw row json preserved unchanged
    const srcRow = (await getImportRows(imp.id))[0];
    assert.deepStrictEqual(a.raw_row_json, srcRow.raw_data_json);

    await cleanup();
  });

  await t.test('invalid period rejected before transaction', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('PERIODBRAND');
    const imp = await createTestImport(VALID_CSV_1, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    await assert.rejects(
      () =>
        commitImport({
          importId: imp.id,
          userId: user.id,
          periodStartDate: 'not-a-date',
          periodEndDate: PERIOD.period_end_date,
        }),
      (err: any) => err.name === 'InvalidCommitPeriodError'
    );

    const stmtCount = await prisma.statement.count();
    assert.strictEqual(stmtCount, 0, 'No Statement should be created on invalid period');

    await cleanup();
  });

  await t.test('reversed period rejected', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('PERIODBRAND2');
    const imp = await createTestImport(VALID_CSV_1, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    await assert.rejects(
      () =>
        commitImport({
          importId: imp.id,
          userId: user.id,
          periodStartDate: '2026-05-01',
          periodEndDate: '2026-04-01',
        }),
      (err: any) => err.name === 'InvalidCommitPeriodError'
    );

    await cleanup();
  });

  await t.test('preflight blocker (invalid rows) prevents ALL writes', async () => {
    const user = await createUser('MANAGER');
    const imp = await createTestImport(INVALID_CSV, user.id);
    await processImport(imp.id);

    await assert.rejects(
      () =>
        commitImport({
          importId: imp.id,
          userId: user.id,
          periodStartDate: PERIOD.period_start_date,
          periodEndDate: PERIOD.period_end_date,
        }),
      (err: any) => err.name === 'CommitPreflightBlockedError'
    );

    assert.strictEqual(await prisma.statement.count(), 0);
    assert.strictEqual(await prisma.statementRow.count(), 0);
    const updated = await prisma.import.findUnique({ where: { id: imp.id } });
    assert.notStrictEqual(updated?.status, 'COMMITTED');

    await cleanup();
  });

  await t.test('review-required rows prevent commit', async () => {
    const user = await createUser('MANAGER');
    const imp = await createTestImport(REVIEW_CSV, user.id);
    await processImport(imp.id);
    await assert.rejects(
      () =>
        commitImport({
          importId: imp.id,
          userId: user.id,
          periodStartDate: PERIOD.period_start_date,
          periodEndDate: PERIOD.period_end_date,
        }),
      (err: any) => err.name === 'CommitPreflightBlockedError'
    );
    assert.strictEqual(await prisma.statement.count(), 0);
    await cleanup();
  });

  await t.test('duplicate rows prevent commit', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('DUPBRANDC');
    const imp = await createTestImport(DUP_CSV, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);
    await assert.rejects(
      () =>
        commitImport({
          importId: imp.id,
          userId: user.id,
          periodStartDate: PERIOD.period_start_date,
          periodEndDate: PERIOD.period_end_date,
        }),
      (err: any) => err.name === 'CommitPreflightBlockedError'
    );
    assert.strictEqual(await prisma.statement.count(), 0);
    await cleanup();
  });

  await t.test('unmapped rows prevent commit', async () => {
    const user = await createUser('MANAGER');
    const imp = await createTestImport(VALID_CSV_2, user.id);
    await processImport(imp.id);
    await assert.rejects(
      () =>
        commitImport({
          importId: imp.id,
          userId: user.id,
          periodStartDate: PERIOD.period_start_date,
          periodEndDate: PERIOD.period_end_date,
        }),
      (err: any) => err.name === 'CommitPreflightBlockedError'
    );
    assert.strictEqual(await prisma.statement.count(), 0);
    await cleanup();
  });

  await t.test('stale mapping (deleted master) rolls back commit', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('STALEBRAND');
    const imp = await createTestImport(VALID_CSV_1, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    // Simulate a master being removed between preflight and commit
    await prisma.brand.delete({ where: { id: brand.id } });

    await assert.rejects(
      () =>
        commitImport({
          importId: imp.id,
          userId: user.id,
          periodStartDate: PERIOD.period_start_date,
          periodEndDate: PERIOD.period_end_date,
        }),
      (err: any) => err.name === 'CommitPreflightBlockedError'
    );

    assert.strictEqual(await prisma.statement.count(), 0, 'No Statement after rollback');
    assert.strictEqual(await prisma.statementRow.count(), 0, 'No StatementRows after rollback');
    const updated = await prisma.import.findUnique({ where: { id: imp.id } });
    assert.notStrictEqual(updated?.status, 'COMMITTED');
    assert.strictEqual(await prisma.auditLog.count({ where: { action: 'IMPORT_COMMITTED' } }), 0);

    await cleanup();
  });

  await t.test('transaction rollback when StatementRow insert fails (unique import_row_id)', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('ROLLBRAND');
    const imp = await createTestImport(VALID_CSV_2, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    const rows = await getImportRows(imp.id);
    // Pre-insert a StatementRow sharing an import_row_id to force a unique violation
    const dummyStatement = await prisma.statement.create({
      data: { period_start_date: new Date('2026-01-01T12:00:00.000Z'), period_end_date: new Date('2026-01-31T12:00:00.000Z'), source_file_name: 'dummy.csv', status: 'APPROVED' },
    });
    await prisma.statementRow.create({
      data: {
        statement_id: dummyStatement.id,
        import_row_id: rows[0].id,
        source_item_name: 'preexisting',
        raw_row_json: {},
        mapping_status: 'CONFIRMED',
        validation_status: 'VALID',
        duplicate_status: 'NEW',
      },
    });

    await assert.rejects(
      () =>
        commitImport({
          importId: imp.id,
          userId: user.id,
          periodStartDate: PERIOD.period_start_date,
          periodEndDate: PERIOD.period_end_date,
        })
    );

    // Commit must not have created a new Statement / rows / audit / status change
    const committedStmt = await prisma.statement.findFirst({
      where: { source_file_name: 'test.csv' },
    });
    assert.strictEqual(committedStmt, null, 'Commit created no Statement');
    const updated = await prisma.import.findUnique({ where: { id: imp.id } });
    assert.notStrictEqual(updated?.status, 'COMMITTED');
    assert.strictEqual(await prisma.auditLog.count({ where: { action: 'IMPORT_COMMITTED' } }), 0);
    // Only the pre-inserted row (linked to dummy statement) exists
    const linked = await prisma.statementRow.count({ where: { import_row_id: rows[0].id } });
    assert.strictEqual(linked, 1);

    await cleanup();
  });

  await t.test('already committed import rejects second commit', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('ACBRAND');
    const imp = await createTestImport(VALID_CSV_1, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    await commitImport({
      importId: imp.id,
      userId: user.id,
      periodStartDate: PERIOD.period_start_date,
      periodEndDate: PERIOD.period_end_date,
    });

    // A second commit is rejected (preflight blocks a COMMITTED import, or the
    // in-transaction COMMITTED re-check fires). Either way: no second Statement.
    await assert.rejects(() =>
      commitImport({
        importId: imp.id,
        userId: user.id,
        periodStartDate: PERIOD.period_start_date,
        periodEndDate: PERIOD.period_end_date,
      })
    );

    // Exactly one Statement / set of rows / audit
    assert.strictEqual(await prisma.statement.count(), 1);
    assert.strictEqual(await prisma.statementRow.count(), 1);
    assert.strictEqual(await prisma.auditLog.count({ where: { action: 'IMPORT_COMMITTED' } }), 1);

    await cleanup();
  });

  await t.test('repeated commit request is idempotent (no duplicates)', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('REPBRAND');
    const imp = await createTestImport(VALID_CSV_2, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    await commitImport({
      importId: imp.id,
      userId: user.id,
      periodStartDate: PERIOD.period_start_date,
      periodEndDate: PERIOD.period_end_date,
    });
    await assert.rejects(() =>
      commitImport({
        importId: imp.id,
        userId: user.id,
        periodStartDate: PERIOD.period_start_date,
        periodEndDate: PERIOD.period_end_date,
      })
    );

    assert.strictEqual(await prisma.statement.count(), 1);
    assert.strictEqual(await prisma.statementRow.count(), 2);
    assert.strictEqual(await prisma.auditLog.count({ where: { action: 'IMPORT_COMMITTED' } }), 1);

    await cleanup();
  });

  await t.test('empty import cannot be committed', async () => {
    const user = await createUser('MANAGER');
    const imp = await createTestImport(`source_item_name,quantity_unit`, user.id);
    await processImport(imp.id);

    await assert.rejects(
      () =>
        commitImport({
          importId: imp.id,
          userId: user.id,
          periodStartDate: PERIOD.period_start_date,
          periodEndDate: PERIOD.period_end_date,
        }),
      (err: any) => err.name === 'CommitPreflightBlockedError'
    );
    assert.strictEqual(await prisma.statement.count(), 0);

    await cleanup();
  });

  await t.test('concurrent double commit creates exactly one Statement', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('CONCBRAND');
    const imp = await createTestImport(VALID_CSV_2, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    const attempts = await Promise.allSettled([
      commitImport({ importId: imp.id, userId: user.id, periodStartDate: PERIOD.period_start_date, periodEndDate: PERIOD.period_end_date }),
      commitImport({ importId: imp.id, userId: user.id, periodStartDate: PERIOD.period_start_date, periodEndDate: PERIOD.period_end_date }),
    ]);

    const fulfilled = attempts.filter((a) => a.status === 'fulfilled').length;
    const rejected = attempts.filter((a) => a.status === 'rejected').length;
    assert.strictEqual(fulfilled, 1, 'Exactly one concurrent commit succeeds');
    assert.strictEqual(rejected, 1, 'Exactly one concurrent commit fails safely');

    assert.strictEqual(await prisma.statement.count(), 1, 'Exactly one Statement');
    assert.strictEqual(await prisma.statementRow.count(), 2, 'Exactly N StatementRows');
    const updated = await prisma.import.findUnique({ where: { id: imp.id } });
    assert.strictEqual(updated?.status, 'COMMITTED');

    await cleanup();
  });
});

test('Commit Engine - API', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });

  await t.test('successful commit returns 200 with payload', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('APIBRAND');
    const imp = await createTestImport(VALID_CSV_1, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    const { status, body } = await callCommit(imp.id, user.id, PERIOD);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.committedRows, 1);
    assert.strictEqual(body.status, 'COMMITTED');

    await cleanup();
  });

  await t.test('missing x-user-id returns 401', async () => {
    const user = await createUser('MANAGER');
    const imp = await createTestImport(VALID_CSV_1, user.id);
    await processImport(imp.id);
    const { status } = await callCommit(imp.id, '', PERIOD);
    assert.strictEqual(status, 401);
    await cleanup();
  });

  await t.test('user without commit_import permission returns 403', async () => {
    const owner = await createUser('SALES_USER');
    const imp = await createTestImport(VALID_CSV_1, owner.id);
    await processImport(imp.id);
    const { status } = await callCommit(imp.id, owner.id, PERIOD);
    assert.strictEqual(status, 403);
    await cleanup();
  });

  await t.test('non-owner without admin returns 403', async () => {
    const owner = await createUser('SALES_USER');
    const other = await createUser('MANAGER');
    const imp = await createTestImport(VALID_CSV_1, owner.id);
    await processImport(imp.id);
    const { status } = await callCommit(imp.id, other.id, PERIOD);
    assert.strictEqual(status, 403);
    await cleanup();
  });

  await t.test('ADMIN can commit a non-owned import (200)', async () => {
    const owner = await createUser('SALES_USER');
    const admin = await createUser('ADMIN');
    const brand = await createTestBrand('ADMINBRAND');
    const imp = await createTestImport(VALID_CSV_1, owner.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, admin.id);

    const { status, body } = await callCommit(imp.id, admin.id, PERIOD);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.success, true);

    await cleanup();
  });

  await t.test('nonexistent import returns 404', async () => {
    const user = await createUser('MANAGER');
    const { status } = await callCommit('00000000-0000-0000-0000-000000000000', user.id, PERIOD);
    assert.strictEqual(status, 404);
    await cleanup();
  });

  await t.test('invalid period returns 400', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('APIPERIOD');
    const imp = await createTestImport(VALID_CSV_1, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    const { status } = await callCommit(imp.id, user.id, { period_start_date: 'bad', period_end_date: '2026-04-30' });
    assert.strictEqual(status, 400);
    assert.strictEqual(await prisma.statement.count(), 0);
    await cleanup();
  });

  await t.test('commit blocked (unmapped) returns 409', async () => {
    const user = await createUser('MANAGER');
    const imp = await createTestImport(VALID_CSV_1, user.id);
    await processImport(imp.id);

    const { status, body } = await callCommit(imp.id, user.id, PERIOD);
    assert.strictEqual(status, 409);
    assert(Array.isArray(body.blockers) && body.blockers.length > 0);
    assert.strictEqual(await prisma.statement.count(), 0);
    await cleanup();
  });

  await t.test('already committed returns 409', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('APIAC');
    const imp = await createTestImport(VALID_CSV_1, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);
    await commitImport({ importId: imp.id, userId: user.id, periodStartDate: PERIOD.period_start_date, periodEndDate: PERIOD.period_end_date });

    const { status } = await callCommit(imp.id, user.id, PERIOD);
    assert.strictEqual(status, 409);
    await cleanup();
  });
});

import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { before } from 'node:test';

import { processImport } from '../src/lib/import/process';
import prisma from '../src/lib/prisma';
import { seedTestDatabase, cleanupTestData } from './test-setup';
import { getCommitPreflight } from '../src/lib/import/commit-preflight';
import { GET } from '../src/app/api/imports/[id]/commit-preflight/route';

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
  const text = typeof value === 'string' ? value : String(value);
  const trimmed = text.trim();
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

async function callPreflight(importId: string, userId?: string) {
  const headers: Record<string, string> = {};
  if (userId) headers['x-user-id'] = userId;
  const res = await GET(
    new Request(`http://localhost/api/imports/${importId}/commit-preflight`, {
      method: 'GET',
      headers,
    }),
    { params: Promise.resolve({ id: importId }) }
  );
  return { status: res.status, body: (await res.json()) as any };
}

// Headers use canonical field names so they map cleanly (no MAPPING_REQUIRED
// warnings). A quantity_unit column is included so VALID rows stay VALID
// (otherwise MISSING_QUANTITY_UNIT would flag them REVIEW_REQUIRED).
const VALID_CSV_2 = `source_item_name,quantity_unit
Item A,PCS
Item B,PCS`;

const VALID_CSV_1 = `source_item_name,quantity_unit
Item A,PCS`;

const DUP_CSV = `source_item_name,quantity_unit
Item A,PCS
Item A,PCS
Item B,PCS`;

const INVALID_CSV = `source_item_name,reported_purchase_qty
Item A,abc
Item B,def`;

const REVIEW_CSV = `source_item_name,reported_purchase_qty
Item A,-50
Item B,-20`;

test('Commit Preflight - Service', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });

  await t.test('fully valid import is committable', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('VALIDBRAND');

    const imp = await createTestImport(VALID_CSV_2, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    const result = await getCommitPreflight(imp.id);
    assert.strictEqual(result.totalRows, 2);
    assert.strictEqual(result.eligibleRows, 2);
    assert.strictEqual(result.invalidRows, 0);
    assert.strictEqual(result.reviewRequiredRows, 0);
    assert.strictEqual(result.duplicateRows, 0);
    assert.strictEqual(result.unmappedRows, 0);
    assert.strictEqual(result.missingConfirmedMappingRows, 0);
    assert.strictEqual(result.alreadyCommitted, false);
    assert.strictEqual(result.canCommit, true);
    assert.strictEqual(result.blockers.length, 0);

    await cleanup();
  });

  await t.test('invalid rows block commit', async () => {
    const user = await createUser('MANAGER');
    const csv = INVALID_CSV;
    const imp = await createTestImport(csv, user.id);
    await processImport(imp.id);

    const result = await getCommitPreflight(imp.id);
    assert.strictEqual(result.totalRows, 2);
    assert.strictEqual(result.invalidRows, 2);
    assert.strictEqual(result.canCommit, false);
    assert(result.blockers.some((b) => b.includes('invalid')));

    await cleanup();
  });

  await t.test('review-required rows block commit', async () => {
    const user = await createUser('MANAGER');
    const csv = REVIEW_CSV;
    const imp = await createTestImport(csv, user.id);
    await processImport(imp.id);

    const result = await getCommitPreflight(imp.id);
    assert.strictEqual(result.reviewRequiredRows, 2);
    assert.strictEqual(result.canCommit, false);
    assert(result.blockers.some((b) => b.includes('review-required')));

    await cleanup();
  });

  await t.test('unmapped rows block commit', async () => {
    const user = await createUser('MANAGER');
    const imp = await createTestImport(VALID_CSV_2, user.id);
    await processImport(imp.id);

    const result = await getCommitPreflight(imp.id);
    assert.strictEqual(result.unmappedRows, 2);
    assert.strictEqual(result.canCommit, false);
    assert(result.blockers.some((b) => b.includes('unmapped')));

    await cleanup();
  });

  await t.test('rejected and explicitly unmatched rows do not block eligible confirmed rows', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('DECISIONBRAND');
    const imp = await createTestImport(
      `source_item_name,quantity_unit\nConfirmed A,PCS\nConfirmed B,PCS\nRejected C,PCS\nUnmatched D,PCS`,
      user.id,
    );
    await processImport(imp.id);

    const rows = await getImportRows(imp.id);
    await prisma.importRow.updateMany({
      where: { id: { in: rows.slice(0, 2).map((row) => row.id) } },
      data: { confirmed_brand_id: brand.id, confirmed_by_user_id: user.id, confirmed_at: new Date() },
    });
    await prisma.importRow.update({
      where: { id: rows[2].id },
      data: { match_reason: 'MATCH_REJECTED' },
    });
    await prisma.auditLog.create({
      data: { action: 'MATCH_REJECTED', entity_type: 'ImportRow', entity_id: rows[2].id, user_id: user.id },
    });
    await prisma.auditLog.create({
      data: { action: 'MATCH_LEFT_UNMATCHED', entity_type: 'ImportRow', entity_id: rows[3].id, user_id: user.id },
    });

    const result = await getCommitPreflight(imp.id);
    assert.strictEqual(result.eligibleRows, 2);
    assert.strictEqual(result.rejectedRows, 1);
    assert.strictEqual(result.unmatchedRows, 1);
    assert.strictEqual(result.unmappedRows, 0);
    assert.strictEqual(result.missingConfirmedMappingRows, 0);
    assert.strictEqual(result.canCommit, true);
    assert.strictEqual(result.blockers.length, 0);

    await cleanup();
  });

  await t.test('rows with only suggestions (no confirmed) block commit', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('SUGGESTBRAND');
    const imp = await createTestImport(VALID_CSV_2, user.id);
    await processImport(imp.id);

    const rows = await getImportRows(imp.id);
    for (const r of rows) {
      await prisma.importRow.update({
        where: { id: r.id },
        data: { suggested_brand_id: brand.id },
      });
    }

    const result = await getCommitPreflight(imp.id);
    assert.strictEqual(result.missingConfirmedMappingRows, 2);
    assert.strictEqual(result.unmappedRows, 0);
    assert.strictEqual(result.canCommit, false);
    assert(result.blockers.some((b) => b.includes('confirmed mapping')));

    await cleanup();
  });

  await t.test('inconsistent hierarchy (stale product brand) blocks commit', async () => {
    const user = await createUser('MANAGER');
    const brandA = await createTestBrand('BRAND_A');
    const brandB = await createTestBrand('BRAND_B');
    const product = await createTestProduct(brandA.id, 'PRODUCT_A');

    const csv = VALID_CSV_1;
    const imp = await createTestImport(csv, user.id);
    await processImport(imp.id);

    const rows = await getImportRows(imp.id);
    // Confirm with a brand that does NOT own the product -> inconsistent
    await prisma.importRow.update({
      where: { id: rows[0].id },
      data: {
        confirmed_brand_id: brandB.id,
        confirmed_product_id: product.id,
        confirmed_by_user_id: user.id,
        confirmed_at: new Date(),
      },
    });

    const result = await getCommitPreflight(imp.id);
    assert.strictEqual(result.missingConfirmedMappingRows, 1);
    assert.strictEqual(result.canCommit, false);
    assert(
      result.blockers.some(
        (b) => b.toLowerCase().includes('stale') || b.toLowerCase().includes('inconsistent')
      ),
      'Expected a stale/inconsistent mapping blocker'
    );

    await cleanup();
  });

  await t.test('duplicate rows block commit', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('DUPBRAND');
    const csv = DUP_CSV;
    const imp = await createTestImport(csv, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    const result = await getCommitPreflight(imp.id);
    assert(result.duplicateRows > 0, 'Expected at least one duplicate row');
    assert.strictEqual(result.canCommit, false);
    assert(result.blockers.some((b) => b.includes('duplicate')));

    await cleanup();
  });

  await t.test('already committed import is not committable (idempotent)', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('COMMITTEDBRAND');
    const csv = VALID_CSV_1;
    const imp = await createTestImport(csv, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);
    await prisma.import.update({ where: { id: imp.id }, data: { status: 'COMMITTED' } });

    const result = await getCommitPreflight(imp.id);
    assert.strictEqual(result.status, 'COMMITTED');
    assert.strictEqual(result.alreadyCommitted, true);
    assert.strictEqual(result.eligibleRows, 1);
    assert.strictEqual(result.canCommit, false);
    assert(result.blockers.some((b) => b.toLowerCase().includes('already been committed')));

    await cleanup();
  });

  await t.test('empty import blocks commit', async () => {
    const user = await createUser('MANAGER');
    const csv = `source_item_name,quantity_unit`;
    const imp = await createTestImport(csv, user.id);
    await processImport(imp.id);

    const result = await getCommitPreflight(imp.id);
    assert.strictEqual(result.totalRows, 0);
    assert.strictEqual(result.canCommit, false);
    assert(result.blockers.some((b) => b.toLowerCase().includes('no rows')));

    await cleanup();
  });

  await t.test('repeated preflight calls produce identical results', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('REPEATBRAND');
    const imp = await createTestImport(VALID_CSV_2, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    const r1 = await getCommitPreflight(imp.id);
    const r2 = await getCommitPreflight(imp.id);
    assert.deepStrictEqual(r1, r2);

    await cleanup();
  });
});

test('Commit Preflight - API Authorization', async (t) => {
  t.afterEach(async () => {
    await cleanup();
  });

  await t.test('missing x-user-id returns 401', async () => {
    const user = await createUser('MANAGER');
    const imp = await createTestImport(VALID_CSV_2, user.id);
    await processImport(imp.id);

    const { status } = await callPreflight(imp.id);
    assert.strictEqual(status, 401);

    await cleanup();
  });

  await t.test('user without commit_import permission returns 403', async () => {
    const owner = await createUser('SALES_USER');
    const imp = await createTestImport(VALID_CSV_2, owner.id);
    await processImport(imp.id);

    const { status } = await callPreflight(imp.id, owner.id);
    assert.strictEqual(status, 403);

    await cleanup();
  });

  await t.test('non-owner without admin returns 403', async () => {
    const owner = await createUser('SALES_USER');
    const other = await createUser('MANAGER');
    const imp = await createTestImport(VALID_CSV_2, owner.id);
    await processImport(imp.id);

    const { status } = await callPreflight(imp.id, other.id);
    assert.strictEqual(status, 403);

    await cleanup();
  });

  await t.test('admin can access a non-owned import (200)', async () => {
    const owner = await createUser('SALES_USER');
    const admin = await createUser('ADMIN');
    const imp = await createTestImport(VALID_CSV_2, owner.id);
    await processImport(imp.id);

    const { status } = await callPreflight(imp.id, admin.id);
    assert.strictEqual(status, 200);

    await cleanup();
  });

  await t.test('nonexistent import returns 404', async () => {
    const user = await createUser('MANAGER');
    const { status } = await callPreflight('00000000-0000-0000-0000-000000000000', user.id);
    assert.strictEqual(status, 404);

    await cleanup();
  });

  await t.test('owner with permission and valid data returns 200 + canCommit true', async () => {
    const user = await createUser('MANAGER');
    const brand = await createTestBrand('OWNERBRAND');
    const imp = await createTestImport(VALID_CSV_2, user.id);
    await processImport(imp.id);
    await confirmAllRows(imp.id, brand.id, user.id);

    const { status, body } = await callPreflight(imp.id, user.id);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.canCommit, true);

    await cleanup();
  });
});

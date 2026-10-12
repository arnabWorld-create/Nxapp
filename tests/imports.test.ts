import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { afterEach, before } from 'node:test';
import prisma from '../src/lib/prisma';
import { GET as importsGET } from '../src/app/api/imports/route';
import { DELETE as importsDELETE } from '../src/app/api/imports/[id]/route';
import { POST as retryPOST } from '../src/app/api/imports/[id]/retry/route';
import { processImport } from '../src/lib/import/process';
import { seedTestDatabase, cleanupTestData } from './test-setup';

const uploadsDir = path.resolve(process.cwd(), 'uploads');
const createdFiles: string[] = [];
const createdImports: string[] = [];
const createdUsers: string[] = [];

before(async () => { await seedTestDatabase(); });

afterEach(async () => {
  await cleanupTestData();
  await Promise.all(createdFiles.map((file) => fs.unlink(file).catch(() => undefined)));
  createdFiles.length = 0;
  createdImports.length = 0;
  createdUsers.length = 0;
});

async function createUser(roleName: string) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  assert(role);
  const user = await prisma.user.create({ data: { name: `history-${roleName}`, email: `history-${roleName}-${Date.now()}@example.com`, mobile_number: `test-${Date.now()}-${createdUsers.length}`, city: 'Test City', password_hash: 'test-hash', role_id: role.id } });
  createdUsers.push(user.id);
  return user;
}

async function createImport(userId: string, name: string, csv: string) {
  const buffer = Buffer.from(csv);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const filePath = path.join(uploadsDir, `${hash}.csv`);
  await fs.writeFile(filePath, buffer);
  createdFiles.push(filePath);
  const record = await prisma.import.create({ data: { file_name: name, file_type: '.csv', file_sha256: hash, uploaded_by: userId } });
  createdImports.push(record.id);
  return record;
}

function request(url: string, userId?: string) {
  return importsGET(new Request(url, { headers: userId ? { 'x-user-id': userId } : {} }));
}

function retryRequest(importId: string, userId: string) {
  return retryPOST(new Request(`http://localhost/api/imports/${importId}/retry`, { method: 'POST', headers: { 'x-user-id': userId } }), { params: Promise.resolve({ id: importId }) });
}

function deleteRequest(importId: string, userId?: string) {
  return importsDELETE(new Request(`http://localhost/api/imports/${importId}`, { method: 'DELETE', headers: userId ? { 'x-user-id': userId } : {} }), { params: Promise.resolve({ id: importId }) });
}

test('Import History API', async (t) => {
  await t.test('requires authentication', async () => {
    const response = await request('http://localhost/api/imports');
    assert.strictEqual(response.status, 401);
  });

  await t.test('scopes owners and allows admins to see all imports', async () => {
    const manager = await createUser('MANAGER');
    const otherManager = await createUser('MANAGER');
    await createImport(manager.id, 'owned.csv', 'Item,Qty\nOwned,1');
    await createImport(otherManager.id, 'other.csv', 'Item,Qty\nOther,1');
    const ownData = await (await request('http://localhost/api/imports?pageSize=100', manager.id)).json();
    assert.deepStrictEqual(ownData.imports.map((item: any) => item.fileName), ['owned.csv']);
    const admin = await createUser('ADMIN');
    const adminData = await (await request('http://localhost/api/imports?pageSize=100', admin.id)).json();
    assert.strictEqual(adminData.total, 2);
  });

  await t.test('delete requires authentication and import ownership', async () => {
    assert.strictEqual((await deleteRequest('missing-import')).status, 401);
    const owner = await createUser('MANAGER');
    const other = await createUser('MANAGER');
    const record = await createImport(owner.id, 'owned-delete.csv', 'Item,Qty\nOwned,1');

    assert.strictEqual((await deleteRequest(record.id, other.id)).status, 403);
    assert.ok(await prisma.import.findUnique({ where: { id: record.id } }));
  });

  await t.test('delete removes an owned import, its rows, and its unshared file', async () => {
    const owner = await createUser('MANAGER');
    const record = await createImport(owner.id, 'delete.csv', 'Item,Qty\nDelete,1');
    await prisma.importRow.create({ data: { import_id: record.id, source_row_number: 1, raw_data_json: { Item: 'Delete', Qty: 1 } } });
    const filePath = path.join(uploadsDir, `${record.file_sha256}.csv`);

    const response = await deleteRequest(record.id, owner.id);
    assert.strictEqual(response.status, 200);
    assert.strictEqual((await response.json()).deleted, true);
    assert.equal(await prisma.import.findUnique({ where: { id: record.id } }), null);
    assert.strictEqual(await prisma.importRow.count({ where: { import_id: record.id } }), 0);
    assert.strictEqual(await fs.access(filePath).then(() => true, () => false), false);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: 'IMPORT_DELETED', entity_id: record.id } }));
  });

  await t.test('delete preserves a stored file referenced by another import', async () => {
    const owner = await createUser('MANAGER');
    const first = await createImport(owner.id, 'duplicate-a.csv', 'Item,Qty\nDuplicate,1');
    await createImport(owner.id, 'duplicate-b.csv', 'Item,Qty\nDuplicate,1');
    const filePath = path.join(uploadsDir, `${first.file_sha256}.csv`);

    const response = await deleteRequest(first.id, owner.id);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await fs.access(filePath).then(() => true, () => false), true);
  });

  await t.test('delete of a committed import also removes its linked statement rows', async () => {
    const owner = await createUser('MANAGER');
    const record = await createImport(owner.id, 'committed-delete.csv', 'Item,Qty\nCommitted,1');
    const statement = await prisma.statement.create({
      data: {
        source_file_name: record.file_name,
        period_start_date: new Date('2026-01-01'),
        period_end_date: new Date('2026-01-31'),
        status: 'APPROVED',
        uploaded_by: owner.id,
      },
    });
    const importRow = await prisma.importRow.create({ data: { import_id: record.id, source_row_number: 1, raw_data_json: { Item: 'Committed', Qty: 1 } } });
    await prisma.statementRow.create({ data: { statement_id: statement.id, import_row_id: importRow.id, source_item_name: 'Committed', raw_row_json: { Item: 'Committed', Qty: 1 } } });
    await prisma.import.update({ where: { id: record.id }, data: { status: 'COMMITTED', statement_id: statement.id } });

    const response = await deleteRequest(record.id, owner.id);
    assert.strictEqual(response.status, 200);
    assert.equal(await prisma.statement.findUnique({ where: { id: statement.id } }), null);
    assert.strictEqual(await prisma.statementRow.count({ where: { statement_id: statement.id } }), 0);
    assert.equal(await prisma.import.findUnique({ where: { id: record.id } }), null);
  });

  await t.test('paginates, searches, filters status, and returns aggregates/uploader', async () => {
    const user = await createUser('ADMIN');
    const first = await createImport(user.id, 'alpha.csv', 'Item,Purchase Qty,Quantity Unit\nAlpha,10,PCS\n,5,PCS');
    await processImport(first.id);
    const second = await createImport(user.id, 'beta.csv', 'Item,Purchase Qty,Quantity Unit\nBeta,20,PCS');
    await prisma.import.update({ where: { id: second.id }, data: { status: 'FAILED' } });

    const page = await (await request('http://localhost/api/imports?page=1&pageSize=1', user.id)).json();
    assert.strictEqual(page.total, 2);
    assert.strictEqual(page.page, 1);
    assert.strictEqual(page.pageSize, 1);
    assert.strictEqual(page.totalPages, 2);
    assert.strictEqual(page.imports.length, 1);
    assert.strictEqual(page.imports[0].fileName, 'beta.csv');
    assert.strictEqual(page.imports[0].uploadedBy.email, user.email);

    const ready = await (await request('http://localhost/api/imports?status=READY_FOR_REVIEW&pageSize=10', user.id)).json();
    assert.strictEqual(ready.total, 1);
    assert.strictEqual(ready.imports[0].fileName, 'alpha.csv');
    assert.deepStrictEqual(ready.imports[0].aggregates, { totalRows: 2, validRows: 2, invalidRows: 0, reviewRequiredRows: 0, duplicateRows: 0, dataRows: 1, summaryRows: 1, nonDataRows: 0, confirmedMappingRows: 0, commitEligibleRows: 0 });

    const searched = await (await request('http://localhost/api/imports?search=ALPHA&pageSize=10', user.id)).json();
    assert.strictEqual(searched.total, 1);
    assert.strictEqual(searched.imports[0].fileName, 'alpha.csv');
  });

  await t.test('processing failures persist FAILED', async () => {
    const user = await createUser('MANAGER');
    const record = await prisma.import.create({ data: { file_name: 'missing.csv', file_type: '.csv', file_sha256: 'missing-hash', uploaded_by: user.id } });
    createdImports.push(record.id);
    await assert.rejects(() => processImport(record.id));
    const failed = await prisma.import.findUnique({ where: { id: record.id } });
    assert.strictEqual(failed?.status, 'FAILED');
    assert.strictEqual(failed?.failure_stage, 'LOAD_FILE');
    assert.match(failed?.failure_message ?? '', /uploaded file/i);
    assert.ok(failed?.failed_at);
  });

  await t.test('retry reuses the Import, clears stale rows, and audits lifecycle', async () => {
    const user = await createUser('MANAGER');
    const record = await createImport(user.id, 'retry.csv', 'Item,Qty,Quantity Unit\nRetry Item,10,PCS');
    await prisma.import.update({ where: { id: record.id }, data: { status: 'FAILED', failure_stage: 'PARSE_FILE', failure_message: 'old failure', failed_at: new Date(0) } });
    await prisma.importRow.create({ data: { import_id: record.id, source_row_number: 99, raw_data_json: { stale: true }, row_type: 'DATA_ROW' } });

    const response = await retryRequest(record.id, user.id);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.importId, record.id);
    assert.strictEqual(data.status, 'READY_FOR_REVIEW');
    const updated = await prisma.import.findUnique({ where: { id: record.id } });
    assert.strictEqual(updated?.status, 'READY_FOR_REVIEW');
    assert.strictEqual(updated?.failure_message, null);
    assert.strictEqual(updated?.failed_at, null);
    const rows = await prisma.importRow.findMany({ where: { import_id: record.id } });
    assert.strictEqual(rows.length, 1);
    assert.notStrictEqual(rows[0].source_row_number, 99);
    const audits = await prisma.auditLog.findMany({ where: { entity_id: record.id }, orderBy: { created_at: 'asc' } });
    assert.ok(audits.some((audit) => audit.action === 'IMPORT_RETRY_REQUESTED'));
    assert.ok(audits.some((audit) => audit.action === 'IMPORT_PROCESSING_STARTED'));
    assert.ok(audits.some((audit) => audit.action === 'IMPORT_PROCESSING_COMPLETED'));
    assert.ok(audits.some((audit) => audit.action === 'IMPORT_RETRY_COMPLETED'));
  });

  await t.test('retry rejects non-failed, unauthorized, and concurrent requests', async () => {
    const owner = await createUser('MANAGER');
    const other = await createUser('MANAGER');
    const ready = await createImport(owner.id, 'ready.csv', 'Item,Qty\nReady,1');
    await processImport(ready.id);
    assert.strictEqual((await retryRequest(ready.id, owner.id)).status, 409);
    const committed = await createImport(owner.id, 'committed.csv', 'Item,Qty\nCommitted,1');
    await prisma.import.update({ where: { id: committed.id }, data: { status: 'COMMITTED' } });
    assert.strictEqual((await retryRequest(committed.id, owner.id)).status, 409);
    const failed = await createImport(owner.id, 'failed.csv', 'Item,Qty\nFailed,1');
    await prisma.import.update({ where: { id: failed.id }, data: { status: 'FAILED' } });
    assert.strictEqual((await retryRequest(failed.id, other.id)).status, 403);
    const [first, second] = await Promise.all([retryRequest(failed.id, owner.id), retryRequest(failed.id, owner.id)]);
    assert.deepStrictEqual([first.status, second.status].sort(), [200, 409]);
  });

  await t.test('failed retry records new failure context', async () => {
    const user = await createUser('MANAGER');
    const record = await createImport(user.id, 'failed-retry.csv', 'Item,Qty\nFailed,1');
    await prisma.import.update({ where: { id: record.id }, data: { status: 'FAILED', failure_stage: 'PARSE_FILE', failure_message: 'previous failure', failed_at: new Date(0) } });
    await fs.unlink(path.join(uploadsDir, `${record.file_sha256}.csv`));
    const response = await retryRequest(record.id, user.id);
    assert.strictEqual(response.status, 500);
    const failed = await prisma.import.findUnique({ where: { id: record.id } });
    assert.strictEqual(failed?.status, 'FAILED');
    assert.strictEqual(failed?.failure_stage, 'LOAD_FILE');
    assert.notStrictEqual(failed?.failure_message, 'previous failure');
    assert.ok(failed?.failed_at && failed.failed_at.getTime() > 0);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'IMPORT_RETRY_FAILED', entity_id: record.id } });
    assert.ok(audit);
  });
});

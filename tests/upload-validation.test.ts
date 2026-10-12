import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { before, afterEach } from 'node:test';

import { processImportUpload, ValidationError, AuthorizationError } from '../src/lib/import/upload';
import prisma from '../src/lib/prisma';
import { POST } from '../src/app/api/imports/route';
import { seedTestDatabase, cleanupTestData } from './test-setup';
import { storage } from '../src/lib/storage';

const createdImports: Array<{ id: string; fileKey: string }> = [];
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
      mobile_number: `test-${Date.now()}-${createdUsers.length}`,
      city: 'Test City',
      password_hash: 'test-hash',
      role_id: role.id,
    },
  });

  createdUsers.push(user.id);
  return user;
}

async function cleanup() {
  await cleanupTestData();
  await Promise.all(createdImports.map(async ({ id, fileKey }) => {
    try {
      await prisma.import.delete({ where: { id } });
    } catch {
      // ignore
    }
    try {
      await storage.delete(fileKey);
    } catch {
      // ignore
    }
  }));
  createdImports.length = 0;

  await Promise.all(createdUsers.map(async (userId) => {
    try {
      await prisma.user.delete({ where: { id: userId } });
    } catch {
      // ignore
    }
  }));
  createdUsers.length = 0;
}

afterEach(async () => {
  await cleanup();
});

test.after(async () => {
  await cleanup();
});

test('VALID CSV upload succeeds and creates Import record', async (t) => {
  const user = await createUser('SALES_USER');
  const content = 'source_item_name,reported_purchase_qty\nTest Item,100\n';
  const file = new File([content], 'valid.csv', { type: 'text/csv' });

  const result = await processImportUpload(file, user.id);
  assert.equal(result.importRecord.file_name, 'valid.csv');
  assert.equal(result.importRecord.file_type, 'text/csv');
  assert.equal(result.importRecord.status, 'UPLOADED');
  assert.equal(result.importRecord.uploaded_by, user.id);

  const expectedHash = crypto.createHash('sha256').update(content).digest('hex');
  assert.equal(result.importRecord.file_sha256, expectedHash);
  assert.equal(result.storedFileKey, `imports/${expectedHash}.csv`);

  const dbRecord = await prisma.import.findUnique({ where: { id: result.importRecord.id } });
  assert.ok(dbRecord, 'Import record should exist in the database');
  assert.equal(dbRecord?.file_name, 'valid.csv');
  assert.equal(dbRecord?.file_type, 'text/csv');
  assert.equal(dbRecord?.file_sha256, expectedHash);
  assert.equal(dbRecord?.uploaded_by, user.id);
  assert.equal(dbRecord?.status, 'UPLOADED');

  createdImports.push({ id: result.importRecord.id, fileKey: result.storedFileKey });
});

test('VALID XLSX upload is accepted based on signature', async (t) => {
  const user = await createUser('SALES_USER');
  const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const file = new File([buffer], 'sheet.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  const result = await processImportUpload(file, user.id);
  assert.equal(result.importRecord.file_name, 'sheet.xlsx');
  assert.equal(result.importRecord.status, 'UPLOADED');
  assert.equal(result.storedFileKey, `imports/${result.importRecord.file_sha256}.xlsx`);

  createdImports.push({ id: result.importRecord.id, fileKey: result.storedFileKey });
});

test('VALID XLS upload is accepted based on signature', async (t) => {
  const user = await createUser('SALES_USER');
  const buffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
  const file = new File([buffer], 'legacy.xls', { type: 'application/vnd.ms-excel' });

  const result = await processImportUpload(file, user.id);
  assert.equal(result.importRecord.file_name, 'legacy.xls');
  assert.equal(result.importRecord.status, 'UPLOADED');
  assert.equal(result.storedFileKey, `imports/${result.importRecord.file_sha256}.xls`);

  createdImports.push({ id: result.importRecord.id, fileKey: result.storedFileKey });
});

test('VALID .xls filename is accepted', async () => {
  const user = await createUser('SALES_USER');
  const buffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
  const file = new File([buffer], '20260831_162216_CNX.xls', { type: 'application/vnd.ms-excel' });

  const result = await processImportUpload(file, user.id);
  assert.equal(result.importRecord.file_name, '20260831_162216_CNX.xls');
  assert.equal(result.importRecord.status, 'UPLOADED');

  createdImports.push({ id: result.importRecord.id, fileKey: result.storedFileKey });
});

test('VALID uppercase .XLS filename is accepted', async () => {
  const user = await createUser('SALES_USER');
  const buffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
  const file = new File([buffer], 'LEGACY.XLS', { type: 'application/vnd.ms-excel' });

  const result = await processImportUpload(file, user.id);
  assert.equal(result.importRecord.file_name, 'LEGACY.XLS');
  assert.equal(result.importRecord.status, 'UPLOADED');

  createdImports.push({ id: result.importRecord.id, fileKey: result.storedFileKey });
});

test('VALID .xlsx filename is accepted', async () => {
  const user = await createUser('SALES_USER');
  const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const file = new File([buffer], 'sheet.XLSX', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  const result = await processImportUpload(file, user.id);
  assert.equal(result.importRecord.file_name, 'sheet.XLSX');
  assert.equal(result.importRecord.status, 'UPLOADED');

  createdImports.push({ id: result.importRecord.id, fileKey: result.storedFileKey });
});

test('VALID .csv filename is accepted', async () => {
  const user = await createUser('SALES_USER');
  const file = new File(['source_item_name\nTest Item'], 'report.CSV', { type: 'text/csv' });

  const result = await processImportUpload(file, user.id);
  assert.equal(result.importRecord.file_name, 'report.CSV');
  assert.equal(result.importRecord.status, 'UPLOADED');

  createdImports.push({ id: result.importRecord.id, fileKey: result.storedFileKey });
});

test('INVALID .pdf filename is rejected before upload', async () => {
  const user = await createUser('SALES_USER');
  const file = new File(['%PDF-1.4'], 'bad.pdf', { type: 'application/pdf' });

  await assert.rejects(async () => {
    await processImportUpload(file, user.id);
  }, ValidationError);
});

test('INVALID extension is rejected before upload', async () => {
  const user = await createUser('SALES_USER');
  const file = new File(['dummy'], 'bad.exe', { type: 'application/octet-stream' });

  await assert.rejects(async () => {
    await processImportUpload(file, user.id);
  }, ValidationError);
});

test('EXTENSION/SIGNATURE mismatch rejects upload', async () => {
  const user = await createUser('SALES_USER');
  const csvContent = 'source_item_name\nBad Content';
  const wrongFile = new File([csvContent], 'bad.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  await assert.rejects(async () => {
    await processImportUpload(wrongFile, user.id);
  }, ValidationError);

  const badBinary = new File([Buffer.from([0, 1, 2, 3])], 'bad.csv', { type: 'text/csv' });
  await assert.rejects(async () => {
    await processImportUpload(badBinary, user.id);
  }, ValidationError);
});

test('EMPTY file is rejected', async () => {
  const user = await createUser('SALES_USER');
  const emptyFile = new File([''], 'empty.csv', { type: 'text/csv' });

  await assert.rejects(async () => {
    await processImportUpload(emptyFile, user.id);
  }, ValidationError);
});

test('FILE SIZE LIMIT behaves as expected', async () => {
  const user = await createUser('SALES_USER');
  const limit = 15 * 1024 * 1024;
  const prefix = 'source_item_name,reported_purchase_qty\n';
  const payload = 'a'.repeat(1024);
  const below = Buffer.from(prefix + payload + 'b'.repeat(limit - prefix.length - payload.length - 2) + '\n');
  const exact = Buffer.from(prefix + payload + 'b'.repeat(limit - prefix.length - payload.length - 1) + '\n');
  const above = Buffer.from(prefix + payload + 'b'.repeat(limit - prefix.length - payload.length - 1) + '\n' + 'c');

  assert.equal(below.length, limit - 1);
  assert.equal(exact.length, limit);
  assert.equal(above.length, limit + 1);

  const belowFile = new File([below], 'below.csv', { type: 'text/csv' });
  const exactFile = new File([exact], 'exact.csv', { type: 'text/csv' });
  const aboveFile = new File([above], 'above.csv', { type: 'text/csv' });

  const belowResult = await processImportUpload(belowFile, user.id);
  createdImports.push({ id: belowResult.importRecord.id, fileKey: belowResult.storedFileKey });
  const exactResult = await processImportUpload(exactFile, user.id);
  createdImports.push({ id: exactResult.importRecord.id, fileKey: exactResult.storedFileKey });

  await assert.rejects(async () => {
    await processImportUpload(aboveFile, user.id);
  }, ValidationError);
});

test('MALICIOUS filename is sanitized and stored safely', async () => {
  const user = await createUser('SALES_USER');
  const content = 'source_item_name\nTest Item';
  const file = new File([content], '../evil/..\\escape.csv', { type: 'text/csv' });

  const result = await processImportUpload(file, user.id);
  assert.equal(result.importRecord.file_name, 'escape.csv');
  assert.equal(result.importRecord.file_type, 'text/csv');
  assert.equal(result.storedFileKey, `imports/${result.importRecord.file_sha256}.csv`);
  assert.ok(!result.storedFileKey.includes('..'));

  createdImports.push({ id: result.importRecord.id, fileKey: result.storedFileKey });
});

test('SHA-256 is deterministic and content sensitive', () => {
  const content = 'known content';
  const hash1 = crypto.createHash('sha256').update(content).digest('hex');
  const hash2 = crypto.createHash('sha256').update(content).digest('hex');
  const hash3 = crypto.createHash('sha256').update(`${content}!`).digest('hex');

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
  assert.equal(hash1.length, 64);
});

test('AUTHORIZATION allows upload_import for SALES_USER and MANAGER', async () => {
  const salesUser = await createUser('SALES_USER');
  const managerUser = await createUser('MANAGER');
  const content = 'source_item_name\nAuthorized';
  const file = new File([content], 'auth.csv', { type: 'text/csv' });

  const salesUpload = await processImportUpload(file, salesUser.id);
  createdImports.push({ id: salesUpload.importRecord.id, fileKey: salesUpload.storedFileKey });

  const managerUpload = await processImportUpload(file, managerUser.id);
  assert.equal(managerUpload.importRecord.uploaded_by, managerUser.id);
  createdImports.push({ id: managerUpload.importRecord.id, fileKey: managerUpload.storedFileKey });

  await assert.rejects(async () => {
    await processImportUpload(file, 'nonexistent-user-id');
  }, AuthorizationError);
});

test('API route rejects unauthenticated multipart/form-data requests', async () => {
  const formData = new FormData();
  formData.append('file', new File(['a,b\n1,2'], 'route.csv', { type: 'text/csv' }));
  const request = new Request('http://localhost/api/imports', {
    method: 'POST',
    body: formData,
  });

  const response = await POST(request);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, 'Missing authentication for server-side authorization');
});

test('Failed uploads do not create partial Import records', async () => {
  const user = await createUser('SALES_USER');
  const badFile = new File([Buffer.from([0, 1, 2, 3])], 'bad.csv', { type: 'text/csv' });
  const hash = crypto.createHash('sha256').update(Buffer.from([0, 1, 2, 3])).digest('hex');

  await assert.rejects(async () => {
    await processImportUpload(badFile, user.id);
  }, ValidationError);

  const existing = await prisma.import.findFirst({ where: { file_sha256: hash } });
  assert.equal(existing, null);
});

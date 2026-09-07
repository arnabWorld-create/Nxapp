import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import prisma from '../src/lib/prisma';
import { approveStatement, StatementApprovalConflictError } from '../src/lib/statements/approval';
import { POST } from '../src/app/api/statements/[id]/approve/route';
import { hashPassword } from '../src/lib/auth/password';
import { seedTestDatabase, cleanupTestData } from './test-setup';

let managerId: string;
let salesId: string;
let statementId: string;

before(async () => {
  await seedTestDatabase();
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { name: 'MANAGER' } });
  const salesRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SALES_USER' } });
  const manager = await prisma.user.create({ data: { name: 'Approval Manager', email: `approval-manager-${Date.now()}@example.com`, password_hash: hashPassword('secret'), role_id: managerRole.id } });
  const sales = await prisma.user.create({ data: { name: 'Approval Sales', email: `approval-sales-${Date.now()}@example.com`, password_hash: hashPassword('secret'), role_id: salesRole.id } });
  managerId = manager.id;
  salesId = sales.id;
  const statement = await prisma.statement.create({ data: { period_start_date: new Date('2026-05-01'), period_end_date: new Date('2026-05-31'), source_file_name: 'approval.csv', status: 'READY_FOR_REVIEW', uploaded_by: salesId } });
  statementId = statement.id;
});

after(async () => {
  await cleanupTestData();
});

test('approves a READY_FOR_REVIEW statement and records approval metadata/audit', async () => {
  const statement = await approveStatement({ statementId, userId: managerId, note: 'Reviewed for QA' });
  assert.equal(statement.status, 'APPROVED');
  assert.equal(statement.approved_by, managerId);
  assert(statement.approved_at);
  assert.equal(statement.approval_note, 'Reviewed for QA');

  const audit = await prisma.auditLog.findFirst({ where: { action: 'STATEMENT_APPROVED', entity_id: statementId } });
  assert(audit);
  assert.equal(audit.user_id, managerId);
});

test('does not approve an already approved statement twice', async () => {
  await assert.rejects(() => approveStatement({ statementId, userId: managerId }), StatementApprovalConflictError);
});

test('approval API enforces permission and returns approval metadata', async () => {
  const statement = await prisma.statement.create({ data: { period_start_date: new Date('2026-06-01'), period_end_date: new Date('2026-06-30'), source_file_name: 'approval-api.csv', status: 'READY_FOR_REVIEW', uploaded_by: salesId } });
  const denied = await POST(new Request('http://localhost/api/statements/' + statement.id + '/approve', { method: 'POST', headers: { 'x-user-id': salesId }, body: JSON.stringify({}) }), { params: Promise.resolve({ id: statement.id }) });
  assert.equal(denied.status, 403);

  const allowed = await POST(new Request('http://localhost/api/statements/' + statement.id + '/approve', { method: 'POST', headers: { 'x-user-id': managerId }, body: JSON.stringify({ note: 'API approval' }) }), { params: Promise.resolve({ id: statement.id }) });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.statement.status, 'APPROVED');
  assert.equal(body.statement.approval_note, 'API approval');
});
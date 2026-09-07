import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import prisma from '../src/lib/prisma';
import { POST as createUserRoute, GET as listUsersRoute } from '../src/app/api/users/route';
import { PATCH as updateUserRoute } from '../src/app/api/users/[id]/route';
import { authenticateUser } from '../src/lib/auth';
import { hashPassword } from '../src/lib/auth/password';
import { cleanupTestData, seedTestDatabase } from './test-setup';

let adminId: string;
let salesId: string;
let managerRoleId: string;
let salesRoleId: string;

before(async () => {
  await seedTestDatabase();
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
  const salesRole = await prisma.role.findUniqueOrThrow({ where: { name: 'SALES_USER' } });
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { name: 'MANAGER' } });
  managerRoleId = managerRole.id;
  salesRoleId = salesRole.id;
  adminId = (await prisma.user.create({ data: { name: 'Test User Admin', email: `test-user-admin-${Date.now()}@example.com`, password_hash: hashPassword('adminpass123'), role_id: adminRole.id } })).id;
  salesId = (await prisma.user.create({ data: { name: 'Test User Sales', email: `test-user-sales-${Date.now()}@example.com`, password_hash: hashPassword('salespass123'), role_id: salesRole.id } })).id;
});

after(async () => { await cleanupTestData(); });

function request(path: string, options: RequestInit = {}, userId?: string) {
  const headers = new Headers(options.headers);
  if (userId) headers.set('x-user-id', userId);
  return new Request(`http://localhost/api${path}`, { ...options, headers });
}

test('user management requires authentication and manage_user permission', async () => {
  assert.equal((await listUsersRoute(request('/users'))).status, 401);
  assert.equal((await listUsersRoute(request('/users', {}, salesId))).status, 403);
  assert.equal((await createUserRoute(request('/users', { method: 'POST', body: '{}' }, salesId))).status, 403);
});

test('admin can create, list, edit, and deactivate a user without exposing hashes', async () => {
  const createResponse = await createUserRoute(request('/users', { method: 'POST', body: JSON.stringify({ name: 'Managed User', email: `test-managed-${Date.now()}@example.com`, password: 'managedpass123', role_id: managerRoleId, status: 'ACTIVE' }) }, adminId));
  assert.equal(createResponse.status, 201);
  const createdBody = await createResponse.json();
  assert.equal(createdBody.user.role.name, 'MANAGER');
  assert.equal(createdBody.user.status, 'ACTIVE');
  assert.equal('password_hash' in createdBody.user, false);
  const managedId = createdBody.user.id as string;

  const stored = await prisma.user.findUniqueOrThrow({ where: { id: managedId } });
  assert.notEqual(stored.password_hash, 'managedpass123');
  assert.equal((await authenticateUser(stored.email, 'managedpass123'))?.id, managedId);

  const listResponse = await listUsersRoute(request('/users?search=Managed%20User', {}, adminId));
  assert.equal(listResponse.status, 200);
  const listBody = await listResponse.json();
  assert.equal(listBody.users.length, 1);
  assert.equal('password_hash' in listBody.users[0], false);

  const editResponse = await updateUserRoute(request(`/users/${managedId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Inactive Managed User', email: stored.email, role_id: salesRoleId, status: 'INACTIVE' }) }, adminId), { params: Promise.resolve({ id: managedId }) });
  assert.equal(editResponse.status, 200);
  const editBody = await editResponse.json();
  assert.equal(editBody.user.status, 'INACTIVE');
  assert.equal(editBody.user.role.name, 'SALES_USER');
  assert.equal(await authenticateUser(stored.email, 'managedpass123'), null);

  const auditActions = await prisma.auditLog.findMany({ where: { entity_id: managedId }, select: { action: true } });
  assert(auditActions.some((entry) => entry.action === 'USER_CREATED'));
  assert(auditActions.some((entry) => entry.action === 'USER_UPDATED'));
  assert(auditActions.some((entry) => entry.action === 'USER_DEACTIVATED'));
  assert(auditActions.some((entry) => entry.action === 'ROLE_CHANGED'));
});

test('duplicate email and self-lockout are rejected', async () => {
  const existing = await prisma.user.findUniqueOrThrow({ where: { id: salesId } });
  const duplicate = await createUserRoute(request('/users', { method: 'POST', body: JSON.stringify({ name: 'Duplicate', email: existing.email, password: 'duplicate123', role_id: salesRoleId, status: 'ACTIVE' }) }, adminId));
  assert.equal(duplicate.status, 409);

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
  const selfUpdate = await updateUserRoute(request(`/users/${adminId}`, { method: 'PATCH', body: JSON.stringify({ name: 'Test User Admin', email: 'test-user-admin@example.com', role_id: adminRole.id, status: 'INACTIVE' }) }, adminId), { params: Promise.resolve({ id: adminId }) });
  assert.equal(selfUpdate.status, 409);
});

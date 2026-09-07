import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import prisma from '../src/lib/prisma';
import { POST as createDistributor, GET as listDistributors } from '../src/app/api/distributors/route';
import { PATCH as updateDistributor } from '../src/app/api/distributors/[id]/route';
import { POST as commit } from '../src/app/api/imports/[id]/commit/route';
import { cleanupTestData, seedTestDatabase } from './test-setup';

let managerId: string;
let salespersonId: string;
let distributorId: string;
const suffix = Date.now();

before(async () => {
  await seedTestDatabase();
  const [managerRole, salesRole] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { name: 'MANAGER' } }),
    prisma.role.findUniqueOrThrow({ where: { name: 'SALES_USER' } }),
  ]);
  managerId = (await prisma.user.create({ data: { name: `Distributor Manager ${suffix}`, email: `test-distributor-manager-${suffix}@example.com`, password_hash: 'test', role_id: managerRole.id } })).id;
  salespersonId = (await prisma.user.create({ data: { name: `Distributor Salesperson ${suffix}`, email: `test-distributor-sales-${suffix}@example.com`, password_hash: 'test', role_id: salesRole.id } })).id;
});

after(async () => {
  await cleanupTestData();
  await prisma.distributor.deleteMany({ where: { normalized_name: { startsWith: `distributor-${suffix}` } } });
});

function request(path: string, userId: string, method = 'GET', body?: unknown) {
  return new Request(`http://localhost/api${path}`, { method, headers: { 'x-user-id': userId, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('distributor CRUD assigns a salesperson and prevents duplicate normalized names', async () => {
  const createdResponse = await createDistributor(request('/distributors', managerId, 'POST', { name: `Distributor ${suffix}`, salesperson_user_id: salespersonId, effective_from: '2026-01-01' }));
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).distributor;
  distributorId = created.id;
  assert.equal(created.salesperson.id, salespersonId);

  const duplicateResponse = await createDistributor(request('/distributors', managerId, 'POST', { name: ` distributor ${suffix} `, effective_from: '2026-01-01' }));
  assert.equal(duplicateResponse.status, 409);

  const listResponse = await listDistributors(request(`/distributors?salesperson_id=${salespersonId}&status=ACTIVE`, managerId));
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).distributors[0].id, distributorId);
});

test('missing or inactive distributor cannot be used for a new statement, while historical statements remain', async () => {
  const importRecord = await prisma.import.create({ data: { file_name: `distributor-${suffix}.csv`, file_type: '.csv', status: 'READY_FOR_REVIEW', uploaded_by: managerId } });
  const missing = await commit(request(`/imports/${importRecord.id}/commit`, managerId, 'POST', { period_start_date: '2026-01-01', period_end_date: '2026-01-31' }), { params: Promise.resolve({ id: importRecord.id }) });
  assert.equal(missing.status, 400);

  const historical = await prisma.statement.create({ data: { period_start_date: new Date('2026-01-01'), period_end_date: new Date('2026-01-31'), source_file_name: 'historical.csv', status: 'APPROVED', uploaded_by: managerId, distributor_id: distributorId } });
  const deactivate = await updateDistributor(request(`/distributors/${distributorId}`, managerId, 'PATCH', { status: 'INACTIVE' }), { params: Promise.resolve({ id: distributorId }) });
  assert.equal(deactivate.status, 200);

  const inactive = await commit(request(`/imports/${importRecord.id}/commit`, managerId, 'POST', { distributor_id: distributorId, period_start_date: '2026-02-01', period_end_date: '2026-02-28' }), { params: Promise.resolve({ id: importRecord.id }) });
  assert.equal(inactive.status, 409);
  const retained = await prisma.statement.findUnique({ where: { id: historical.id }, select: { distributor_id: true } });
  assert.equal(retained?.distributor_id, distributorId);
});

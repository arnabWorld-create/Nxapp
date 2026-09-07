import assert from 'node:assert/strict';
import test, { before } from 'node:test';

import prisma from '../src/lib/prisma';
import { POST as createMasterPOST } from '../src/app/api/imports/[id]/matches/create/route';
import { MatchingEngine } from '../src/lib/matching/engine';
import { normalizeSourceItemName } from '../src/lib/matching/utils';
import { seedTestDatabase, cleanupTestData } from './test-setup';

before(async () => {
  await seedTestDatabase();
});

test('Create Master learns a Product mapping across separate imports', async (t) => {
  t.afterEach(async () => {
    await cleanupTestData();
  });

  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'MANAGER' } });
  const manager = await prisma.user.create({
    data: {
      name: `test-master-${Date.now()}`,
      email: `test-master-${Date.now()}@example.com`,
      password_hash: 'test-hash',
      role_id: role.id,
    },
  });
  const divisionName = `CNX Main ${Date.now()}`;
  const division = await prisma.division.create({ data: { name: divisionName, normalized_name: divisionName.toLowerCase() } });
  const sourceNames = ['METACNG SR-500 MG TAB.', 'PRESTILLER-MNT TAB.'];
  const importA = await prisma.import.create({ data: { file_name: 'first.csv', file_type: '.csv', uploaded_by: manager.id } });
  const importB = await prisma.import.create({ data: { file_name: 'second.csv', file_type: '.csv', uploaded_by: manager.id } });
  for (const [index, sourceName] of sourceNames.entries()) {
    const normalizedSourceName = normalizeSourceItemName(sourceName);
    const rowA = await prisma.importRow.create({ data: { import_id: importA.id, source_row_number: index + 1, raw_data_json: { Item: sourceName } as any, parsed_data_json: { normalizedData: { source_item_name: normalizedSourceName } } as any } });
    const response = await createMasterPOST(
      new Request(`http://localhost/api/imports/${importA.id}/matches/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': manager.id },
        body: JSON.stringify({ importRowId: rowA.id, entityType: 'PRODUCT', name: sourceName, divisionId: division.id }),
      }),
      { params: Promise.resolve({ id: importA.id }) }
    );
    assert.strictEqual(response.status, 201);
    const created = await response.json();
    const product = await prisma.product.findUnique({ where: { id: created.master.id } });
    assert(product);
    assert.strictEqual(product.division_id, division.id);
    const learned = await prisma.learnedMapping.findFirst({ where: { product_id: product.id, entity_key: `PRODUCT:${product.id}` } });
    assert(learned);
    assert.strictEqual(learned.normalized_source_name, normalizedSourceName);

    const rowB = await prisma.importRow.create({ data: { import_id: importB.id, source_row_number: index + 1, raw_data_json: { Item: sourceName } as any, parsed_data_json: { normalizedData: { source_item_name: normalizedSourceName } } as any } });
    const match = await new MatchingEngine().suggestMatches({ importRowId: rowB.id, sourceName });
    assert.strictEqual(match.candidates[0]?.entityId, product.id);
    assert.strictEqual(match.requiresConfirmation, false);
    assert(['alias_match', 'normalized_exact_match', 'safe_normalized_master_match'].includes(match.candidates[0]?.reason ?? ''));
  }
});

test('Create Master requires an active Division and safely reuses a duplicate Product', async (t) => {
  t.afterEach(async () => {
    await cleanupTestData();
  });

  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'MANAGER' } });
  const manager = await prisma.user.create({ data: { name: `test-duplicate-${Date.now()}`, email: `test-duplicate-${Date.now()}@example.com`, password_hash: 'test-hash', role_id: role.id } });
  const division = await prisma.division.create({ data: { name: `DERMA ${Date.now()}`, normalized_name: `derma ${Date.now()}` } });
  const inactiveDivision = await prisma.division.create({ data: { name: `Inactive ${Date.now()}`, normalized_name: `inactive ${Date.now()}`, status: 'INACTIVE' } });
  const importRecord = await prisma.import.create({ data: { file_name: 'duplicates.csv', file_type: '.csv', uploaded_by: manager.id } });
  const row = await prisma.importRow.create({ data: { import_id: importRecord.id, source_row_number: 1, row_type: 'DATA_ROW', raw_data_json: { Item: 'DUPLICATE MEDICINE TAB.' } as any, parsed_data_json: { normalizedData: { source_item_name: 'duplicate medicine' } } as any } });

  const request = (body: Record<string, unknown>) => createMasterPOST(
    new Request(`http://localhost/api/imports/${importRecord.id}/matches/create`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': manager.id }, body: JSON.stringify({ importRowId: row.id, entityType: 'PRODUCT', name: 'DUPLICATE MEDICINE', ...body }) }),
    { params: Promise.resolve({ id: importRecord.id }) }
  );

  assert.strictEqual((await request({})).status, 400);
  assert.strictEqual((await request({ divisionId: inactiveDivision.id })).status, 404);

  const first = await request({ divisionId: division.id });
  assert.strictEqual(first.status, 201);
  const firstData = await first.json();
  assert.strictEqual(firstData.master.division_id, division.id);
  const second = await request({ divisionId: division.id });
  assert.strictEqual(second.status, 200);
  const secondData = await second.json();
  assert.strictEqual(secondData.reusedExistingProduct, true);
  assert.strictEqual(secondData.master.id, firstData.master.id);
  const confirmedRow = await prisma.importRow.findUnique({ where: { id: row.id } });
  assert.strictEqual(confirmedRow?.confirmed_product_id, firstData.master.id);
  assert.strictEqual(confirmedRow?.match_reason, 'AUTO_MATCHED:MASTER_CREATED');
  assert.strictEqual(await prisma.product.count({ where: { division_id: division.id, normalized_name: 'duplicate medicine' } }), 1);
});
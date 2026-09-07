import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import prisma from '../src/lib/prisma';
import { createDivision, createProduct, MasterAlreadyExistsError } from '../src/lib/master-data/create';
import { cleanupTestData, seedTestDatabase } from './test-setup';

before(async () => {
  await cleanupTestData();
  await seedTestDatabase();
});

after(async () => {
  await cleanupTestData();
});

test('creates a Division and a direct Master Medicine Item without Brand', async () => {
  const division = await createDivision({ name: 'QA Cardio Diabeto' });
  const product = await createProduct({ name: 'TELTRANX 40 MG TAB', divisionId: division.id });

  assert.equal(product.division_id, division.id);
  assert.equal(product.brand_id, null);
});

test('rejects duplicate direct Product names within one Division', async () => {
  const division = await createDivision({ name: 'QA Ortho' });
  await createProduct({ name: 'QA MEDICINE 20 MG TAB', divisionId: division.id });

  await assert.rejects(
    () => createProduct({ name: 'qa medicine 20 mg tab', divisionId: division.id }),
    (error: unknown) => error instanceof MasterAlreadyExistsError,
  );
});

test('allows the same direct Product name in different Divisions', async () => {
  const firstDivision = await createDivision({ name: 'QA Prime' });
  const secondDivision = await createDivision({ name: 'QA Plus' });
  const first = await createProduct({ name: 'QA SHARED 10 MG TAB', divisionId: firstDivision.id });
  const second = await createProduct({ name: 'QA SHARED 10 MG TAB', divisionId: secondDivision.id });

  assert.notEqual(first.id, second.id);
});

test('keeps legacy Product with Brand compatible', async () => {
  const brand = await prisma.brand.create({ data: { name: 'QA Legacy Brand', normalized_name: 'qa legacy brand' } });
  const product = await createProduct({ name: 'QA Legacy Product', brandId: brand.id });

  assert.equal(product.brand_id, brand.id);
  assert.equal(product.division_id, null);
});
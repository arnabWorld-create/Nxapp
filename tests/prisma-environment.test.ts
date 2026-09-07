import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createPrismaAdapter, resolvePrismaSchema } from '../src/lib/prisma';

test('test environment defaults to the isolated nxapp_test schema', () => {
  assert.equal(resolvePrismaSchema({ NODE_ENV: 'test' }), 'nxapp_test');
  assert.equal(
    resolvePrismaSchema({ NODE_ENV: 'test', TEST_DATABASE_SCHEMA: 'nxapp_custom_test' }),
    'nxapp_custom_test',
  );
});

test('explicit schema is passed to PrismaPg and controls runtime queries', { skip: !process.env.PRISMA_EXPLICIT_SCHEMA_TEST }, async () => {
  const schema = process.env.PRISMA_EXPLICIT_SCHEMA_TEST;
  assert(schema);

  const connectionUrl = new URL(process.env.DATABASE_URL ?? '');
  connectionUrl.searchParams.delete('options');
  const client = new PrismaClient({
    adapter: createPrismaAdapter(connectionUrl.toString(), schema),
  });

  try {
    assert.equal(await client.product.count(), 1);
  } finally {
    await client.$disconnect();
  }
});

test('production never falls back to the test schema', () => {
  assert.equal(resolvePrismaSchema({ NODE_ENV: 'production' }), undefined);
  assert.equal(resolvePrismaSchema({ NODE_ENV: 'production', DATABASE_SCHEMA: 'nxapp_rehearsal_20260904' }), 'nxapp_rehearsal_20260904');
});

test('development preserves normal database behavior without an override', () => {
  assert.equal(resolvePrismaSchema({ NODE_ENV: 'development' }), undefined);
  assert.equal(resolvePrismaSchema({ NODE_ENV: undefined }), undefined);
});

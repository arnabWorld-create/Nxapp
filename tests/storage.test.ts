import assert from 'node:assert/strict';
import test from 'node:test';
import { createFileStorage } from '../src/lib/storage';
import { createLocalFileStorage } from '../src/lib/storage/local';
import { createSupabaseFileStorage } from '../src/lib/storage/supabase';
import { getStorageKey } from '../src/lib/import/upload';

test('deterministic storage keys include imports prefix, hash, and extension', () => {
  assert.equal(getStorageKey('a'.repeat(64), '.xlsx'), `imports/${'a'.repeat(64)}.xlsx`);
});

test('local storage puts, gets, checks, and deletes by logical key', async () => {
  const storage = createLocalFileStorage();
  const key = `imports/storage-test-${Date.now()}.csv`;
  const body = Buffer.from('source_item_name\nStorage Test\n');

  await storage.put({ key, body, contentType: 'text/csv' });
  assert.equal(await storage.exists(key), true);
  assert.deepEqual(await storage.get(key), body);
  await storage.delete(key);
  assert.equal(await storage.exists(key), false);
});

test('Supabase storage adapter delegates to the private bucket client', async () => {
  const calls: string[] = [];
  const fakeClient = {
    storage: {
      from(bucket: string) {
        return {
          upload: async (key: string, body: Buffer, options: { contentType: string; upsert: boolean }) => {
            calls.push(`upload:${bucket}:${key}:${body.length}:${options.contentType}:${options.upsert}`);
            return { error: null };
          },
          download: async (key: string) => {
            calls.push(`download:${bucket}:${key}`);
            return { data: new Blob([Buffer.from('remote')]), error: null };
          },
          remove: async (keys: string[]) => {
            calls.push(`remove:${bucket}:${keys[0]}`);
            return { error: null };
          },
          list: async (directory: string, options: { search?: string }) => {
            calls.push(`list:${bucket}:${directory}:${options.search}`);
            return { data: [{ name: options.search }], error: null };
          },
        };
      },
    },
  } as never;
  const storage = createSupabaseFileStorage({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only', SUPABASE_STORAGE_BUCKET: 'private-imports' }, fakeClient);

  await storage.put({ key: 'imports/file.csv', body: Buffer.from('x'), contentType: 'text/csv' });
  assert.deepEqual(await storage.get('imports/file.csv'), Buffer.from('remote'));
  assert.equal(await storage.exists('imports/file.csv'), true);
  await storage.delete('imports/file.csv');
  assert.deepEqual(calls, [
    'upload:private-imports:imports/file.csv:1:text/csv:true',
    'download:private-imports:imports/file.csv',
    'list:private-imports:imports:file.csv',
    'remove:private-imports:imports/file.csv',
  ]);
});

test('Supabase configuration fails clearly when required server variables are missing', () => {
  assert.throws(
    () => createSupabaseFileStorage({ SUPABASE_URL: 'https://example.supabase.co' }),
    /SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET/,
  );
});

test('production never silently falls back to local storage', () => {
  assert.throws(() => createFileStorage({ NODE_ENV: 'production' }), /STORAGE_PROVIDER/);
  assert.throws(() => createFileStorage({ NODE_ENV: 'production', STORAGE_PROVIDER: 'supabase' }), /Supabase storage requires/);
});
import 'dotenv/config';

const configuredUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!configuredUrl) {
  throw new Error('Tests require DATABASE_URL or TEST_DATABASE_URL');
}

const schema = process.env.TEST_DATABASE_SCHEMA || 'nxapp_test';

if (schema === 'public' || schema === 'postgres') {
  throw new Error('Tests cannot run against the public database schema');
}

const testUrl = new URL(configuredUrl);
testUrl.searchParams.delete('schema');
testUrl.searchParams.set('options', `-c search_path=${schema},public`);
process.env.DATABASE_URL = testUrl.toString();
process.env.TEST_DATABASE_SCHEMA = schema;
process.env.NODE_ENV = 'test';
process.env.STORAGE_PROVIDER = 'local';
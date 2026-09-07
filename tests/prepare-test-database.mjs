import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { spawnSync } from 'node:child_process';

const configuredUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!configuredUrl) throw new Error('DATABASE_URL or TEST_DATABASE_URL is required');

const testUrl = new URL(configuredUrl);
const schema = process.env.TEST_DATABASE_SCHEMA || 'nxapp_test';
if (schema === 'public' || schema === 'postgres') throw new Error('Refusing to prepare a public test schema');
testUrl.searchParams.set('schema', schema);

const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: configuredUrl }) });
await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema.replaceAll('"', '""')}"`);
await admin.$disconnect();

const result = spawnSync('npx.cmd', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
  env: { ...process.env, DATABASE_URL: testUrl.toString() },
  stdio: 'inherit',
  shell: true,
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
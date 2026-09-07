import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// DATABASE_SCHEMA is a server-only PrismaPg override; unset means the database default.
export function resolvePrismaSchema(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.NODE_ENV === 'test') {
    return env.TEST_DATABASE_SCHEMA || 'nxapp_test';
  }

  return env.DATABASE_SCHEMA?.trim() || undefined;
}

export const prismaSchema = resolvePrismaSchema();

export function createPrismaAdapter(
  connectionString: string | undefined = process.env.DATABASE_URL,
  schema: string | undefined = prismaSchema,
): PrismaPg {
  return new PrismaPg(
    { connectionString },
    schema ? { schema } : undefined,
  );
}

const adapter = createPrismaAdapter();

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const prisma = global.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

export default prisma;

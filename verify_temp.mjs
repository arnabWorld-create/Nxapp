import 'dotenv/config';
const { PrismaClient } = await import('@prisma/client');
const { PrismaPg } = await import('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

try {
  const constraintRows = await prisma.$queryRawUnsafe(`
    SELECT c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'StatementRow'
    ORDER BY c.conname
  `);
  console.log('constraints', JSON.stringify(constraintRows, null, 2));

  const rpRows = await prisma.$queryRawUnsafe(`
    SELECT r.name AS role_name, p.name AS permission_name, rp.role_id, rp.permission_id
    FROM "RolePermission" rp
    JOIN "Role" r ON rp.role_id = r.id
    JOIN "Permission" p ON rp.permission_id = p.id
    ORDER BY r.name, p.name
  `);
  console.log('rolePermissions', JSON.stringify(rpRows, null, 2));

  const stmtFk = await prisma.$queryRawUnsafe(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = (SELECT oid FROM pg_class WHERE relname='StatementRow')
      AND contype='f'
  `);
  console.log('statementRowFks', JSON.stringify(stmtFk, null, 2));
} catch (e) {
  console.error(e);
} finally {
  await prisma.$disconnect();
}

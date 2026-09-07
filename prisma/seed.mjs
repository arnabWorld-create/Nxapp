import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

if (process.env.APP_ENV !== 'local-qa' || process.env.NODE_ENV === 'production' || process.env.DATABASE_SCHEMA !== 'public') {
  throw new Error('Refusing to seed: explicit local-qa environment with DATABASE_SCHEMA=public is required');
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    update: {},
    create: { name: 'ADMIN', description: 'Full system access' }
  });

  const managerRole = await prisma.role.upsert({
    where: { name: 'MANAGER' },
    update: {},
    create: { name: 'MANAGER', description: 'Manager-level access' }
  });

  const salesRole = await prisma.role.upsert({
    where: { name: 'SALES_USER' },
    update: {},
    create: { name: 'SALES_USER', description: 'Sales user access' }
  });

  const permissions = [
    'upload_import',
    'view_import',
    'review_import',
    'commit_import',
    'view_statement',
    'view_report',
    'manage_brand',
    'manage_product',
    'manage_variant',
    'manage_mapping',
    'view_audit',
    'manage_user',
    'manage_statement_approval'
  ];

  const permissionRecords = [];
  for (const name of permissions) {
    const permission = await prisma.permission.upsert({
      where: { name },
      update: {},
      create: { name, description: `${name} permission` }
    });
    permissionRecords.push(permission);
  }

  const permissionMap = Object.fromEntries(permissionRecords.map(p => [p.name, p]));

  const rolePermissions = [
    // ADMIN gets every permission
    ...permissions.map(name => ({ role_id: adminRole.id, permission_id: permissionMap[name].id })),
    // MANAGER gets import review/commit, statement/report, and brand/product management
    ...[
      'view_import',
      'review_import',
      'commit_import',
      'view_statement',
      'view_report',
      'manage_brand',
      'manage_product',
      'manage_variant',
      'manage_user',
      'manage_statement_approval'
    ].map(name => ({ role_id: managerRole.id, permission_id: permissionMap[name].id })),
    // SALES_USER gets import upload/view, statement view, and mapping support
    ...[
      'upload_import',
      'view_import',
      'view_statement',
      'manage_mapping'
    ].map(name => ({ role_id: salesRole.id, permission_id: permissionMap[name].id })),
  ];

  await prisma.rolePermission.createMany({
    data: rolePermissions,
    skipDuplicates: true,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import 'dotenv/config';
import prisma, { prismaSchema } from '../src/lib/prisma';

if (process.env.NODE_ENV !== 'test' || prismaSchema !== 'nxapp_test') {
  throw new Error('Refusing test cleanup without an isolated test database schema');
}

const ROLES = ['ADMIN', 'MANAGER', 'SALES_USER'];

const PERMISSIONS = [
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
  'manage_statement_approval',
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: PERMISSIONS,
  MANAGER: [
    'upload_import',
    'view_import',
    'review_import',
    'commit_import',
    'view_statement',
    'view_report',
    'manage_brand',
    'manage_product',
    'manage_user',
    'manage_statement_approval',
  ],
  SALES_USER: ['upload_import', 'view_import', 'view_statement', 'manage_mapping'],
};

export async function seedTestDatabase(): Promise<void> {
  for (const roleName of ROLES) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: `${roleName} role` },
    });
  }

  const permissionMap = new Map<string, string>();
  for (const permName of PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { name: permName },
      update: {},
      create: { name: permName, description: `${permName} permission` },
    });
    permissionMap.set(permName, perm.id);
  }

  for (const [roleName, permNames] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;

    for (const permName of permNames) {
      const permId = permissionMap.get(permName);
      if (!permId) continue;

      await prisma.rolePermission.upsert({
        where: { role_id_permission_id: { role_id: role.id, permission_id: permId } },
        update: {},
        create: { role_id: role.id, permission_id: permId },
      });
    }
  }
}

export async function cleanupTestData(): Promise<void> {
  // Topological order respects FKs: StatementRow -> ImportRow -> Import ->
  // Statement (Import references Statement via statement_id), then variants,
  // products, brands, audit logs, users.
  await prisma.statementRow.deleteMany({});
  await prisma.importRow.deleteMany({});
  await prisma.import.deleteMany({});
  await prisma.statement.deleteMany({});
  await prisma.productVariant.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.brand.deleteMany({});
  await prisma.division.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { startsWith: 'test-' } },
        { email: { startsWith: 'auth-' } },
        { email: { startsWith: 'inactive-' } },
      ],
    },
  });
}

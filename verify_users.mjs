import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const roles = await prisma.role.findMany({
  include: { role_permissions: { include: { permission: true } }, users: { select: { id: true, email: true, name: true, status: true } } },
});
for (const r of roles) {
  console.log(`ROLE ${r.name} (${r.id}) — users: ${r.users.length}, perms: ${r.role_permissions.map(rp => rp.permission.name).join(', ')}`);
}
const users = await prisma.user.findMany({ select: { email: true, name: true, status: true, role: { select: { name: true } } } });
console.log('USERS:', JSON.stringify(users, null, 2));
await prisma.$disconnect();

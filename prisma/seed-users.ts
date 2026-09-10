import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPassword } from '../src/lib/auth/password';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Demo users. Passwords are intentionally simple for local/dev use only.
  const users = [
    { email: 'admin@nxapp.local', name: 'Administrator', role: 'ADMIN', password: 'admin123' },
    { email: 'manager@nxapp.local', name: 'Manager User', role: 'MANAGER', password: 'manager123' },
    { email: 'sales@nxapp.local', name: 'Sales User', role: 'SALES_USER', password: 'sales123' },
  ];

  for (const u of users) {
    const role = await prisma.role.findUnique({ where: { name: u.role } });
    if (!role) {
      console.error(`Role ${u.role} not found. Run prisma seed first.`);
      continue;
    }

    const password_hash = hashPassword(u.password);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { password_hash, role_id: role.id, status: 'ACTIVE' },
      create: {
        email: u.email,
        name: u.name,
        mobile_number: '',
        city: '',
        password_hash,
        role_id: role.id,
        status: 'ACTIVE',
      },
    });
    console.log(`Upserted user ${u.email} (role: ${u.role})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
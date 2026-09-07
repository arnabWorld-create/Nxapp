import 'dotenv/config';
const { PrismaClient } = await import('@prisma/client');
const { PrismaPg } = await import('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main(){
  try{
    const roles = await prisma.$queryRaw`SELECT name FROM "Role" WHERE name IN ('ADMIN','MANAGER','SALES_USER')`;
    const perms = await prisma.$queryRaw`SELECT name FROM "Permission" WHERE name IN ('upload_import','view_import','review_import','commit_import','view_statement','view_report','manage_brand','manage_product','manage_mapping','view_audit')`;
    const mapCount = await prisma.$queryRaw`SELECT count(*)::int as c FROM "RolePermission"`;
    console.log('roles:', roles.map(r=>r.name));
    console.log('permissions:', perms.map(p=>p.name));
    console.log('role_permissions_count:', mapCount[0].c);
  }catch(e){
    console.error('ERR',e);
  }finally{await prisma.$disconnect();}
}

main();

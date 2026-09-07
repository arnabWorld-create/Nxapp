import 'dotenv/config';
const { PrismaClient } = await import('@prisma/client');
const { PrismaPg } = await import('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main(){
  try{
    const tables = await prisma.$queryRaw`SELECT table_name FROM information_schema.columns WHERE column_name='updated_at' AND table_schema='public'`;
    console.log('Tables with updated_at:', tables.map(r=>r.table_name));
    for (const r of tables){
      const tbl = r.table_name;
      const triggers = await prisma.$queryRaw`
        SELECT tgname, pg_get_triggerdef(t.oid) as def
        FROM pg_trigger t
        JOIN pg_class tc ON t.tgrelid = tc.oid
        WHERE lower(tc.relname) = lower(${tbl}) AND NOT t.tgisinternal
      `;
      console.log('\nTriggers for', tbl, triggers);
    }
  }catch(e){
    console.error('ERR',e);
  }finally{await prisma.$disconnect();}
}

main();

import 'dotenv/config';
const { PrismaClient } = await import('@prisma/client');
const { PrismaPg } = await import('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main(){
  try{
    console.log('\n-- pg_indexes for Product --');
    const prodIdx = await prisma.$queryRaw`SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE tablename='Product'`;
    console.log(prodIdx);

    console.log('\n-- pg_indexes for ProductVariant --');
    const pvIdx = await prisma.$queryRaw`SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE tablename='ProductVariant'`;
    console.log(pvIdx);

    console.log('\n-- pg_constraint for StatementRow --');
    const stmt = await prisma.$queryRaw`SELECT conname, contype::text as contype, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = (select oid from pg_class where relname='StatementRow')`;
    console.log(stmt);

    console.log('\n-- pg_constraint for ProductVariant --');
    const pv = await prisma.$queryRaw`SELECT conname, contype::text as contype, pg_get_constraintdef(oid) as def FROM pg_constraint WHERE conrelid = (select oid from pg_class where relname='ProductVariant')`;
    console.log(pv);

  }catch(e){
    console.error('ERR',e);
  }finally{
    await prisma.$disconnect();
  }
}

main();

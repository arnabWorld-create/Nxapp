import fs from 'fs';
import path from 'path';

const { PrismaClient } = await import('@prisma/client');
const { PrismaPg } = await import('@prisma/adapter-pg');
import 'dotenv/config';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function printHeader(h){
  console.log('\n--- ' + h + ' ---');
}

async function printConstraintsFor(tableName){
  printHeader(`Constraints for ${tableName}`);
  const rows = await prisma.$queryRaw`
    SELECT c.conname, (c.contype::text) as contype, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE lower(t.relname) = lower(${tableName}) AND n.nspname = 'public'
    ORDER BY c.conname
  `;
  console.log(JSON.stringify(rows, null, 2));
}

async function printTableColumns(tableName){
  printHeader(`Columns for ${tableName}`);
  const cols = await prisma.$queryRaw`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND lower(table_name)=lower(${tableName})
    ORDER BY ordinal_position
  `;
  console.log(JSON.stringify(cols, null, 2));
}

async function printTableDDL(tableName){
  printHeader(`DDL-ish for ${tableName}`);
  const ddl = await prisma.$queryRaw`
    SELECT 'CREATE TABLE '||quote_ident(n.nspname)||'.'||quote_ident(c.relname)|| E' (\n' ||
      string_agg('  '||quote_ident(a.attname)||' '||pg_catalog.format_type(a.atttypid,a.atttypmod) ||
      (case when a.attnotnull then ' NOT NULL' else '' end) ||
      (case when ad.adbin is not null then ' DEFAULT '||pg_get_expr(ad.adbin, ad.adrelid) else '' end), E',\n') || E'\n);' as ddl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0
    LEFT JOIN pg_attrdef ad ON ad.adrelid=c.oid AND ad.adnum=a.attnum
    WHERE lower(c.relname)=lower(${tableName}) AND n.nspname='public'
    GROUP BY n.nspname,c.relname
  `;
  console.log(ddl[0]?.ddl || 'No DDL found');
}

async function checkSpecificConstraints(){
  printHeader('Check specific composite constraints');
  // A) statement_rows(product_id, brand_id) REFERENCES products(id, brand_id)
  const a = await prisma.$queryRaw`
    SELECT c.conname, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE lower(t.relname)=lower('StatementRow') AND c.contype='f'
    AND pg_get_constraintdef(c.oid) ILIKE '%references%product%(%id%brand_id%'
  `;
  console.log('A) Matches:', JSON.stringify(a, null, 2));

  // B) statement_rows(variant_id, product_id) REFERENCES product_variants(id, product_id)
  const b = await prisma.$queryRaw`
    SELECT c.conname, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE lower(t.relname)=lower('StatementRow') AND c.contype='f'
    AND pg_get_constraintdef(c.oid) ILIKE '%references%product_variant%(%id%product_id%'
  `;
  console.log('B) Matches:', JSON.stringify(b, null, 2));

  // 4. Verify parent unique constraints exist
  printHeader('Parent unique constraints for products');
  const pu = await prisma.$queryRaw`
    SELECT c.conname, (c.contype::text) as contype, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE lower(t.relname)=lower('Product') AND c.contype IN ('u','p')
  `;
  console.log(JSON.stringify(pu, null, 2));

  printHeader('Parent unique constraints for product_variants');
  const pvu = await prisma.$queryRaw`
    SELECT c.conname, (c.contype::text) as contype, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE lower(t.relname)=lower('ProductVariant') AND c.contype IN ('u','p')
  `;
  console.log(JSON.stringify(pvu, null, 2));
}

function printMigrationSql(){
  printHeader('Prisma migration SQL files (first migration)');
  const migrationsDir = path.resolve(process.cwd(),'prisma','migrations');
  if (!fs.existsSync(migrationsDir)){
    console.log('No migrations directory');
    return;
  }
  const dirs = fs.readdirSync(migrationsDir).filter(d => fs.statSync(path.join(migrationsDir,d)).isDirectory());
  for (const d of dirs) {
    const sqlPath = path.join(migrationsDir,d,'migration.sql');
    console.log('\n-- migration: ' + d + ' --');
    if (fs.existsSync(sqlPath)){
      console.log(fs.readFileSync(sqlPath,'utf8'));
    } else {
      console.log('No migration.sql in', d);
    }
  }
}

async function main(){
  try{
    await printConstraintsFor('StatementRow');
    await printTableColumns('StatementRow');
    await printTableDDL('StatementRow');

    await printConstraintsFor('Product');
    await printTableColumns('Product');
    await printTableDDL('Product');

    await printConstraintsFor('ProductVariant');
    await printTableColumns('ProductVariant');
    await printTableDDL('ProductVariant');

    await checkSpecificConstraints();

    printMigrationSql();
  }catch(e){
    console.error('DIAG ERROR', e);
  }finally{
    await prisma.$disconnect();
  }
}

main();

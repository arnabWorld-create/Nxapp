import fs from 'fs';
import path from 'path';
import 'dotenv/config';
const { PrismaClient } = await import('@prisma/client');
const { PrismaPg } = await import('@prisma/adapter-pg');
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function print(title, obj){
  console.log('\n== ' + title + ' ==');
  console.log(JSON.stringify(obj, null, 2));
}

async function run(){
  try{
    // 1. Duplicate Product IDs
    const dupProducts = await prisma.$queryRaw`
      SELECT id, COUNT(*)::int as cnt FROM "Product" GROUP BY id HAVING COUNT(*) > 1
    `;
    print('dupProducts', {count: dupProducts.length, rows: dupProducts.slice(0,10)});

    // 2. Duplicate ProductVariant IDs
    const dupVariants = await prisma.$queryRaw`
      SELECT id, COUNT(*)::int as cnt FROM "ProductVariant" GROUP BY id HAVING COUNT(*) > 1
    `;
    print('dupVariants', {count: dupVariants.length, rows: dupVariants.slice(0,10)});

    // 3. StatementRow product_id & brand_id mismatch
    const sr_prod_brand_mismatch = await prisma.$queryRaw`
      SELECT sr.id, sr.product_id, sr.brand_id, p.brand_id as product_brand_id
      FROM "StatementRow" sr
      LEFT JOIN "Product" p ON sr.product_id = p.id
      WHERE sr.product_id IS NOT NULL AND sr.brand_id IS NOT NULL
        AND (p.id IS NULL OR p.brand_id IS NULL OR p.brand_id != sr.brand_id)
      LIMIT 100
    `;
    const sr_prod_brand_mismatch_count = await prisma.$queryRaw`
      SELECT COUNT(*)::int as c
      FROM "StatementRow" sr
      LEFT JOIN "Product" p ON sr.product_id = p.id
      WHERE sr.product_id IS NOT NULL AND sr.brand_id IS NOT NULL
        AND (p.id IS NULL OR p.brand_id IS NULL OR p.brand_id != sr.brand_id)
    `;
    print('sr_prod_brand_mismatch', {count: sr_prod_brand_mismatch_count[0].c, examples: sr_prod_brand_mismatch});

    // 4. StatementRow variant_id & product_id mismatch
    const sr_variant_prod_mismatch = await prisma.$queryRaw`
      SELECT sr.id, sr.variant_id, sr.product_id, pv.product_id as variant_product_id
      FROM "StatementRow" sr
      LEFT JOIN "ProductVariant" pv ON sr.variant_id = pv.id
      WHERE sr.variant_id IS NOT NULL AND sr.product_id IS NOT NULL
        AND (pv.id IS NULL OR pv.product_id IS NULL OR pv.product_id != sr.product_id)
      LIMIT 100
    `;
    const sr_variant_prod_mismatch_count = await prisma.$queryRaw`
      SELECT COUNT(*)::int as c
      FROM "StatementRow" sr
      LEFT JOIN "ProductVariant" pv ON sr.variant_id = pv.id
      WHERE sr.variant_id IS NOT NULL AND sr.product_id IS NOT NULL
        AND (pv.id IS NULL OR pv.product_id IS NULL OR pv.product_id != sr.product_id)
    `;
    print('sr_variant_prod_mismatch', {count: sr_variant_prod_mismatch_count[0].c, examples: sr_variant_prod_mismatch});

    // 5. NULL combinations
    const a = await prisma.$queryRaw`
      SELECT COUNT(*)::int as c FROM "StatementRow" WHERE product_id IS NULL AND brand_id IS NOT NULL
    `;
    const b = await prisma.$queryRaw`
      SELECT COUNT(*)::int as c FROM "StatementRow" WHERE product_id IS NOT NULL AND brand_id IS NULL
    `;
    const c = await prisma.$queryRaw`
      SELECT COUNT(*)::int as c FROM "StatementRow" WHERE variant_id IS NULL AND product_id IS NOT NULL
    `;
    const d = await prisma.$queryRaw`
      SELECT COUNT(*)::int as c FROM "StatementRow" WHERE variant_id IS NOT NULL AND product_id IS NULL
    `;
    print('null_combinations', {product_null_brand_notnull: a[0].c, product_notnull_brand_null: b[0].c, variant_null_product_notnull: c[0].c, variant_notnull_product_null: d[0].c});

    // 6. Orphan checks for single-column FKs on StatementRow
    const orphan_product = await prisma.$queryRaw`
      SELECT sr.id, sr.product_id FROM "StatementRow" sr LEFT JOIN "Product" p ON sr.product_id=p.id WHERE sr.product_id IS NOT NULL AND p.id IS NULL LIMIT 100
    `;
    const orphan_product_count = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM "StatementRow" sr LEFT JOIN "Product" p ON sr.product_id=p.id WHERE sr.product_id IS NOT NULL AND p.id IS NULL`;

    const orphan_variant = await prisma.$queryRaw`
      SELECT sr.id, sr.variant_id FROM "StatementRow" sr LEFT JOIN "ProductVariant" pv ON sr.variant_id=pv.id WHERE sr.variant_id IS NOT NULL AND pv.id IS NULL LIMIT 100
    `;
    const orphan_variant_count = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM "StatementRow" sr LEFT JOIN "ProductVariant" pv ON sr.variant_id=pv.id WHERE sr.variant_id IS NOT NULL AND pv.id IS NULL`;

    const orphan_brand = await prisma.$queryRaw`
      SELECT sr.id, sr.brand_id FROM "StatementRow" sr LEFT JOIN "Brand" b ON sr.brand_id=b.id WHERE sr.brand_id IS NOT NULL AND b.id IS NULL LIMIT 100
    `;
    const orphan_brand_count = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM "StatementRow" sr LEFT JOIN "Brand" b ON sr.brand_id=b.id WHERE sr.brand_id IS NOT NULL AND b.id IS NULL`;

    const orphan_importrow = await prisma.$queryRaw`
      SELECT sr.id, sr.import_row_id FROM "StatementRow" sr LEFT JOIN "ImportRow" ir ON sr.import_row_id=ir.id WHERE sr.import_row_id IS NOT NULL AND ir.id IS NULL LIMIT 100
    `;
    const orphan_importrow_count = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM "StatementRow" sr LEFT JOIN "ImportRow" ir ON sr.import_row_id=ir.id WHERE sr.import_row_id IS NOT NULL AND ir.id IS NULL`;

    const orphan_statement = await prisma.$queryRaw`
      SELECT sr.id, sr.statement_id FROM "StatementRow" sr LEFT JOIN "Statement" s ON sr.statement_id=s.id WHERE sr.statement_id IS NOT NULL AND s.id IS NULL LIMIT 100
    `;
    const orphan_statement_count = await prisma.$queryRaw`SELECT COUNT(*)::int as c FROM "StatementRow" sr LEFT JOIN "Statement" s ON sr.statement_id=s.id WHERE sr.statement_id IS NOT NULL AND s.id IS NULL`;

    print('orphans', {
      product: {count: orphan_product_count[0].c, examples: orphan_product},
      variant: {count: orphan_variant_count[0].c, examples: orphan_variant},
      brand: {count: orphan_brand_count[0].c, examples: orphan_brand},
      import_row: {count: orphan_importrow_count[0].c, examples: orphan_importrow},
      statement: {count: orphan_statement_count[0].c, examples: orphan_statement}
    });

    // 7. Migration status
    // We'll shell out to prisma migrate status to get the textual status.
    print('migration_status_note', 'See prisma migrate status command output below');
  
  }catch(e){
    console.error('ERROR', e);
  }finally{
    await prisma.$disconnect();
  }
}

run();

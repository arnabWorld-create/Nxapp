import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const { PrismaClient } = await import('@prisma/client');
const { PrismaPg } = await import('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const errors = [];
const warnings = [];

function error(msg) {
  console.error('ERROR:', msg);
  errors.push(msg);
}

function warn(msg) {
  console.warn('WARNING:', msg);
  warnings.push(msg);
}

async function existsTable(name) {
  const res = await prisma.$queryRaw`
    SELECT EXISTS(
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND lower(table_name)=lower(${name})
    ) as exists`;
  return res[0].exists === true || res[0].exists === 't';
}

async function getColumnNames(table) {
  const cols = await prisma.$queryRaw`
    SELECT lower(column_name) as column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND lower(table_name)=lower(${table})
  `;
  return cols.map((c) => c.column_name);
}

async function hasCompositeUnique(table, columns) {
  const expectedCols = columns.map((c) => c.toLowerCase()).join(',');
  const rows = await prisma.$queryRawUnsafe(`
    SELECT string_agg(att.attname, ',' ORDER BY cols.ord) AS cols
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN unnest(i.indkey) WITH ORDINALITY AS cols(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = cols.attnum
    WHERE lower(t.relname) = lower('${table}')
      AND i.indisunique = true
      AND NOT i.indisprimary
    GROUP BY i.indexrelid
  `);
  return rows.some((row) => {
    if (!row.cols) return false;
    const cols = row.cols.toLowerCase();
    return cols === expectedCols;
  });
}

async function hasCompositeFk(table, columns, refTable, refColumns) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      string_agg(src.attname, ',' ORDER BY srckeys.ord) AS cols,
      string_agg(dst.attname, ',' ORDER BY srckeys.ord) AS refcols
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class r ON c.confrelid = r.oid
    JOIN unnest(c.conkey) WITH ORDINALITY AS srckeys(attnum, ord) ON true
    JOIN unnest(c.confkey) WITH ORDINALITY AS dstkeys(attnum, ord) ON srckeys.ord = dstkeys.ord
    JOIN pg_attribute src ON src.attrelid = t.oid AND src.attnum = srckeys.attnum
    JOIN pg_attribute dst ON dst.attrelid = r.oid AND dst.attnum = dstkeys.attnum
    WHERE c.contype = 'f'
      AND lower(t.relname) = lower('${table}')
      AND lower(r.relname) = lower('${refTable}')
    GROUP BY c.oid
  `);

  const expectedCols = columns.map((c) => c.toLowerCase()).join(',');
  const expectedRefCols = refColumns.map((c) => c.toLowerCase()).join(',');
  return rows.some((row) => {
    if (!row.cols || !row.refcols) return false;
    const cols = row.cols.toLowerCase();
    const refcols = row.refcols.toLowerCase();
    return cols === expectedCols && refcols === expectedRefCols;
  });
}

async function hasTriggerOnTable(table) {
  return await prisma.$queryRaw`
    SELECT tgname, pg_get_triggerdef(t.oid) as def
    FROM pg_trigger t
    JOIN pg_class tc ON t.tgrelid = tc.oid
    JOIN pg_namespace n ON tc.relnamespace = n.oid
    WHERE lower(tc.relname) = lower(${table}) AND NOT t.tgisinternal
  `;
}

async function main() {
  console.log('Starting DB verification');

  if (!process.env.DATABASE_URL) error('DATABASE_URL not set in environment');
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    if (!env.includes('DATABASE_URL')) error('.env does not contain DATABASE_URL');
  }

  try {
    const ping = await prisma.$queryRaw`select 1 as ok`;
    if (!ping) error('DB ping failed');
  } catch (e) {
    error('PostgreSQL connectivity failed: ' + e.message);
  }

  const migrationsDir = path.resolve(process.cwd(), 'prisma', 'migrations');
  let migrationFolders = [];
  try {
    migrationFolders = fs.readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (e) {
    error('Unable to read prisma/migrations directory: ' + e.message);
  }

  let appliedMigrations = [];
  try {
    const rows = await prisma.$queryRaw`
      SELECT migration_name FROM "_prisma_migrations"
      ORDER BY migration_name
    `;
    appliedMigrations = rows.map((r) => r.migration_name);
  } catch (e) {
    error('Unable to read _prisma_migrations table: ' + e.message);
  }

  const missingMigrations = migrationFolders.filter((name) => !appliedMigrations.includes(name));
  if (missingMigrations.length > 0) {
    error('Pending migrations found: ' + missingMigrations.join(', '));
  }

  const extraMigrations = appliedMigrations.filter((name) => !migrationFolders.includes(name));
  if (extraMigrations.length > 0) {
    warn('Database contains applied migrations not present in migration folders: ' + extraMigrations.join(', '));
  }

  const tables = [
    'Role','Permission','RolePermission','User','Brand','Product','ProductVariant','Statement','Import','ImportMapping','ImportRow','StatementRow','AuditLog'
  ];
  for (const t of tables) {
    const ok = await existsTable(t);
    if (!ok) error(`Missing table: ${t}`);
  }

  const productCols = await getColumnNames('Product');
  const variantCols = await getColumnNames('ProductVariant');
  if (!productCols.includes('id') || !productCols.includes('brand_id')) {
    error('Product table does not contain id and brand_id columns');
  }
  if (!variantCols.includes('id') || !variantCols.includes('product_id')) {
    error('ProductVariant table does not contain id and product_id columns');
  }

  const productUnique = await hasCompositeUnique('Product', ['id', 'brand_id']);
  if (!productUnique) error('Missing unique constraint on Product(id, brand_id)');

  const variantUnique = await hasCompositeUnique('ProductVariant', ['id', 'product_id']);
  if (!variantUnique) error('Missing unique constraint on ProductVariant(id, product_id)');

  const statementRowToProduct = await hasCompositeFk('StatementRow', ['product_id', 'brand_id'], 'Product', ['id', 'brand_id']);
  if (!statementRowToProduct) error('Missing composite FK from StatementRow(product_id, brand_id) to Product(id, brand_id)');

  const statementRowToProductVariant = await hasCompositeFk('StatementRow', ['variant_id', 'product_id'], 'ProductVariant', ['id', 'product_id']);
  if (!statementRowToProductVariant) error('Missing composite FK from StatementRow(variant_id, product_id) to ProductVariant(id, product_id)');

  const statementRowFields = [
    'reported_purchase_qty',
    'reported_purchase_value',
    'reported_sales_qty',
    'reported_sales_value',
    'reported_sales_return_qty',
    'reported_sales_return_value',
    'reported_purchase_return_qty',
    'reported_purchase_return_value',
    'reported_closing_stock_qty',
    'reported_closing_stock_value',
    'quantity_unit'
  ];
  const statementRowColNames = await getColumnNames('StatementRow');
  for (const field of statementRowFields) {
    if (!statementRowColNames.includes(field)) error(`Missing StatementRow field: ${field}`);
  }

  const importCols = await getColumnNames('Import');
  if (!importCols.includes('file_sha256')) error('Import.file_sha256 missing');

  const importRowCols = await getColumnNames('ImportRow');
  const requiredImportRow = [
    'raw_data_json',
    'parsed_data_json',
    'validation_status',
    'duplicate_status',
    'suggested_brand_id',
    'suggested_product_id',
    'suggested_variant_id'
  ];
  for (const field of requiredImportRow) {
    if (!importRowCols.includes(field)) error(`ImportRow.${field} missing`);
  }

  const tablesWithUpdatedAt = [
    'Role','User','Brand','Product','ProductVariant','Statement','Import','ImportMapping','ImportRow','StatementRow'
  ];
  for (const tbl of tablesWithUpdatedAt) {
    const triggers = await hasTriggerOnTable(tbl);
    if (!triggers || triggers.length === 0) {
      error(`No trigger found on table with updated_at: ${tbl}`);
    } else {
      const hasSetUpdatedAt = triggers.some((row) => row.def && row.def.includes('set_updated_at'));
      if (!hasSetUpdatedAt) error(`Trigger on ${tbl} does not execute set_updated_at() function`);
    }
  }

  const triggerFunction = await prisma.$queryRaw`
    SELECT EXISTS(
      SELECT 1 FROM pg_proc WHERE lower(proname) = lower('set_updated_at')
    ) as exists
  `;
  if (!triggerFunction[0]?.exists) error('Trigger function set_updated_at() not found');

  const expectedMatrix = {
    ADMIN: ['upload_import','view_import','review_import','commit_import','view_statement','view_report','manage_brand','manage_product','manage_mapping','view_audit'],
    MANAGER: ['review_import','commit_import','view_statement','view_report','manage_brand','manage_product'],
    SALES_USER: ['upload_import','view_import','view_statement','manage_mapping']
  };
  const expectedTotal = Object.values(expectedMatrix).reduce((sum, arr) => sum + arr.length, 0);
  console.log('Expected RBAC total from matrix:', expectedTotal);

  const actualRolePermissions = await prisma.$queryRaw`
    SELECT r.name as role_name, p.name as permission_name, rp.role_id, rp.permission_id
    FROM "RolePermission" rp
    JOIN "Role" r ON rp.role_id = r.id
    JOIN "Permission" p ON rp.permission_id = p.id
    ORDER BY r.name, p.name
  `;

  const actualTotal = actualRolePermissions.length;
  const actualCounts = actualRolePermissions.reduce((agg, row) => {
    agg[row.role_name] = (agg[row.role_name] || 0) + 1;
    return agg;
  }, {});
  console.log('Actual RBAC counts:', actualCounts, 'total:', actualTotal);

  for (const role of Object.keys(expectedMatrix)) {
    const expectedCount = expectedMatrix[role].length;
    const actualCount = actualCounts[role] || 0;
    if (actualCount !== expectedCount) warn(`${role} permission count ${actualCount} does not match expected ${expectedCount}`);
    const actualNames = actualRolePermissions.filter((row) => row.role_name === role).map((row) => row.permission_name).sort();
    const missing = expectedMatrix[role].filter((perm) => !actualNames.includes(perm));
    const extra = actualNames.filter((perm) => !expectedMatrix[role].includes(perm));
    if (missing.length > 0) error(`${role} missing permissions: ${missing.join(', ')}`);
    if (extra.length > 0) warn(`${role} has unexpected permissions: ${extra.join(', ')}`);
  }

  if (actualTotal !== expectedTotal) warn(`Actual RolePermission total ${actualTotal} differs from expected ${expectedTotal}`);

  const expectedRows = new Set();
  for (const [role, perms] of Object.entries(expectedMatrix)) {
    for (const perm of perms) expectedRows.add(`${role}::${perm}`);
  }
  const actualRows = new Set(actualRolePermissions.map((row) => `${row.role_name}::${row.permission_name}`));
  const missingRows = [...expectedRows].filter((row) => !actualRows.has(row));
  const extraRows = [...actualRows].filter((row) => !expectedRows.has(row));
  if (missingRows.length > 0) error('Missing RolePermission rows: ' + missingRows.join('; '));
  if (extraRows.length > 0) warn('Extra RolePermission rows: ' + extraRows.join('; '));

  const duplicates = await prisma.$queryRaw`
    SELECT role_id, permission_id, COUNT(*)::int as cnt
    FROM "RolePermission"
    GROUP BY role_id, permission_id
    HAVING COUNT(*) > 1
  `;
  if (duplicates.length > 0) error('Duplicate RolePermission pairs found: ' + duplicates.map((d) => `${d.role_id}/${d.permission_id} (${d.cnt})`).join(', '));

  const prodBrandMismatchCount = await prisma.$queryRaw`
    SELECT COUNT(*)::int as c
    FROM "StatementRow" sr
    LEFT JOIN "Product" p ON sr.product_id = p.id
    WHERE sr.product_id IS NOT NULL AND sr.brand_id IS NOT NULL
      AND (p.id IS NULL OR p.brand_id IS NULL OR p.brand_id != sr.brand_id)
  `;
  if (prodBrandMismatchCount[0].c > 0) error(`Product/Brand mismatch rows: ${prodBrandMismatchCount[0].c}`);

  const variantProductMismatchCount = await prisma.$queryRaw`
    SELECT COUNT(*)::int as c
    FROM "StatementRow" sr
    LEFT JOIN "ProductVariant" pv ON sr.variant_id = pv.id
    WHERE sr.variant_id IS NOT NULL AND sr.product_id IS NOT NULL
      AND (pv.id IS NULL OR pv.product_id IS NULL OR pv.product_id != sr.product_id)
  `;
  if (variantProductMismatchCount[0].c > 0) error(`ProductVariant/Product mismatch rows: ${variantProductMismatchCount[0].c}`);

  const orphanChecks = [
    { name: 'RolePermission.role_id -> Role', sql: `SELECT COUNT(*)::int as c FROM "RolePermission" rp LEFT JOIN "Role" r ON rp.role_id = r.id WHERE r.id IS NULL` },
    { name: 'RolePermission.permission_id -> Permission', sql: `SELECT COUNT(*)::int as c FROM "RolePermission" rp LEFT JOIN "Permission" p ON rp.permission_id = p.id WHERE p.id IS NULL` },
    { name: 'User.role_id -> Role', sql: `SELECT COUNT(*)::int as c FROM "User" u LEFT JOIN "Role" r ON u.role_id = r.id WHERE u.role_id IS NOT NULL AND r.id IS NULL` },
    { name: 'Product.brand_id -> Brand', sql: `SELECT COUNT(*)::int as c FROM "Product" p LEFT JOIN "Brand" b ON p.brand_id = b.id WHERE p.brand_id IS NOT NULL AND b.id IS NULL` },
    { name: 'ProductVariant.product_id -> Product', sql: `SELECT COUNT(*)::int as c FROM "ProductVariant" pv LEFT JOIN "Product" p ON pv.product_id = p.id WHERE pv.product_id IS NOT NULL AND p.id IS NULL` }
  ];
  for (const check of orphanChecks) {
    const res = await prisma.$queryRawUnsafe(check.sql);
    if (res[0].c > 0) error(`${check.name} orphan rows: ${res[0].c}`);
  }

  const nullCombos = [
    { name: 'variant_id without product_id', sql: `SELECT COUNT(*)::int as c FROM "StatementRow" WHERE variant_id IS NOT NULL AND product_id IS NULL` },
    { name: 'product_id without brand_id', sql: `SELECT COUNT(*)::int as c FROM "StatementRow" WHERE product_id IS NOT NULL AND brand_id IS NULL` },
    { name: 'brand_id without product_id', sql: `SELECT COUNT(*)::int as c FROM "StatementRow" WHERE brand_id IS NOT NULL AND product_id IS NULL` }
  ];
  for (const check of nullCombos) {
    const res = await prisma.$queryRawUnsafe(check.sql);
    if (res[0].c > 0) error(`${check.name} unexpected NULL combination rows: ${res[0].c}`);
  }

  console.log('\n=== VERIFICATION SUMMARY ===');
  console.log('Errors:', errors.length);
  console.log('Warnings:', warnings.length);
  console.log('Summary:', errors.length ? 'FAIL' : warnings.length ? 'WARNING' : 'PASS');

  await prisma.$disconnect();
  if (errors.length > 0) process.exit(2);
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(3);
});

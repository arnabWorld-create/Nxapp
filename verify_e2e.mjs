import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const report = [];
function log(...a) { console.log(...a); }

async function api(method, path, { body, cookie, headers } = {}) {
  const opts = { method, headers: { ...(headers || {}) } };
  if (cookie) opts.headers['Cookie'] = cookie;
  if (body !== undefined) {
    if (body instanceof FormData) {
      opts.body = body;
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(BASE + path, opts);
  let json = null;
  try { json = await res.json(); } catch {}
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, json, setCookie };
}

async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  return { cookie: r.setCookie, user: r.json.user };
}

// ---------- STEP 1: MASTER DATA (brands/products) ----------
const admin = await login('admin@nxapp.local', 'admin123');
const sales = await login('sales@nxapp.local', 'sales123');
const manager = await login('manager@nxapp.local', 'manager123');

// Create brand (ADMIN) - use distinctive brand name but product must exactly match CSV "Test Brand Product"
let brandRes = await api('POST', '/api/brands', { body: { name: 'Verification Brand QA', code: 'VQA' }, cookie: admin.cookie });
if (brandRes.status === 409) {
  const existing = await api('GET', '/api/brands?q=Verification%20Brand%20QA', { cookie: admin.cookie });
  brandRes = { status: 201, json: { id: existing.json.brands[0].id } };
}
const brandId = brandRes.json.id;
log('BRAND created id=', brandId, 'status', brandRes.status);

let prodRes = await api('POST', '/api/products', { body: { name: 'Test Brand Product', code: 'TBP', brand_id: brandId }, cookie: admin.cookie });
if (prodRes.status === 409) {
  const existing = await api('GET', '/api/products?q=Test%20Brand%20Product', { cookie: admin.cookie });
  prodRes = { status: 201, json: { id: existing.json.products.find(p => p.brand_id === brandId).id } };
}
const productId = prodRes.json.id;
log('PRODUCT created id=', productId, 'status', prodRes.status);

let varRes = await api('POST', '/api/product-variants', { body: { name: 'Test Brand Product 10s', product_id: productId, pack_size: '10', strength: '10mg' }, cookie: admin.cookie });
const variantId = varRes.status === 201 ? varRes.json.id : null;
log('VARIANT created id=', variantId, 'status', varRes.status);

// ---------- STEP 2: UPLOAD (SALES_USER) ----------
const csv = `source_item_name,reported_purchase_qty,reported_purchase_value,reported_sales_qty,reported_sales_value,quantity_unit
Test Brand Product,10,1000.50,8,800.25,PCS
`;
const fd = new FormData();
fd.append('file', new File([csv], 'qa_test_import.csv', { type: 'text/csv' }));
const upRes = await api('POST', '/api/imports', { body: fd, cookie: sales.cookie });
if (upRes.status !== 201) throw new Error('upload failed: ' + upRes.status + ' ' + JSON.stringify(upRes.json));
const importId = upRes.json.import.id;
log('UPLOAD importId=', importId, 'status', upRes.status);

// Wait for async processing
let status = 'UPLOADED';
for (let i = 0; i < 30; i++) {
  const rev = await api('GET', `/api/imports/${importId}/review`, { cookie: admin.cookie });
  status = rev.json?.import?.status;
  if (status && status !== 'UPLOADED') break;
  await new Promise(r => setTimeout(r, 500));
}
log('PROCESSING status=', status);

// ---------- STEP 3: REVIEW ----------
const review = await api('GET', `/api/imports/${importId}/review`, { cookie: admin.cookie });
const row = review.json.rows[0];
log('REVIEW row0 validation=', row.validationStatus, 'dup=', row.duplicateStatus, 'source=', row.sourceItemName);

// ---------- STEP 4: MATCHING SUGGEST ----------
const sugg = await api('POST', `/api/imports/${importId}/matches/suggest`, { body: { importRowId: row.id }, cookie: admin.cookie });
const cand = sugg.json.candidates?.[0];
log('SUGGEST status=', sugg.json.status, 'topCandidate=', cand ? cand.entityType + ':' + cand.entityId + ' score=' + cand.score : 'none');

// ---------- STEP 5: CONFIRM ----------
const confirmRes = await api('POST', `/api/imports/${importId}/matches/confirm`, {
  body: { importRowId: row.id, selectedCandidateId: `PRODUCT:${productId}`, reason: 'qa-verification' },
  cookie: admin.cookie,
});
log('CONFIRM status=', confirmRes.status, JSON.stringify(confirmRes.json));

// ---------- STEP 6: PREFLIGHT ----------
const pf = await api('GET', `/api/imports/${importId}/commit-preflight`, { cookie: admin.cookie });
log('PREFLIGHT canCommit=', pf.json.canCommit, 'eligible=', pf.json.eligibleRows, 'blockers=', pf.json.blockers);

// ---------- STEP 7: COMMIT ----------
const beforeStatements = await prisma.statement.count();
const commitRes = await api('POST', `/api/imports/${importId}/commit`, {
  body: { period_start_date: '2026-01-01', period_end_date: '2026-01-31' },
  cookie: admin.cookie,
});
log('COMMIT status=', commitRes.status, JSON.stringify(commitRes.json));
const statementId = commitRes.json.statementId;

// ---------- DB VERIFICATION ----------
const imp = await prisma.import.findUnique({ where: { id: importId } });
const stmt = await prisma.statement.findUnique({ where: { id: statementId } });
const stmtRows = await prisma.statementRow.findMany({ where: { statement_id: statementId } });
const audits = await prisma.auditLog.findMany({ where: { action: 'IMPORT_COMMITTED', entity_id: importId } });
const afterStatements = await prisma.statement.count();

log('--- DB CHECKS ---');
log('import.status =', imp.status, '(expect COMMITTED)');
log('import.statement_id set =', !!imp.statement_id);
log('statement.status =', stmt.status, '(expect APPROVED)');
log('statement.period =', stmt.period_start_date.toISOString().slice(0,10), stmt.period_end_date.toISOString().slice(0,10), '(expect 2026-01-01 / 2026-01-31)');
log('statement count delta =', afterStatements - beforeStatements, '(expect 1)');
log('statementRow count =', stmtRows.length, '(expect 1)');
log('statementRow.import_row_id matches =', stmtRows[0]?.import_row_id === row.id);
log('statementRow numeric precision sales_value =', stmtRows[0]?.reported_sales_value?.toString(), '(expect 800.25)');
log('statementRow numeric precision purchase_value =', stmtRows[0]?.reported_purchase_value?.toString(), '(expect 1000.50)');
log('statementRow confirmed product =', stmtRows[0]?.product_id);
log('raw_row_json unchanged =', JSON.stringify(stmtRows[0]?.raw_row_json?.source_item_name));
log('audit IMPORT_COMMITTED count =', audits.length, '(expect 1)');

// ---------- STEP 8: IDEMPOTENCY ----------
const commit2 = await api('POST', `/api/imports/${importId}/commit`, {
  body: { period_start_date: '2026-01-01', period_end_date: '2026-01-31' },
  cookie: admin.cookie,
});
const afterStatements2 = await prisma.statement.count();
const audits2 = await prisma.auditLog.findMany({ where: { action: 'IMPORT_COMMITTED', entity_id: importId } });
const stmtRows2 = await prisma.statementRow.count({ where: { statement_id: statementId } });
log('--- IDEMPOTENCY ---');
log('second commit status =', commit2.status, '(expect 409)');
log('statement count unchanged =', afterStatements2 === afterStatements, `(now ${afterStatements2})`);
log('statementRow count unchanged =', stmtRows2 === 1);
log('audit count unchanged =', audits2.length === 1);

// ---------- STEP 9: AUTHORIZATION ----------
const noAuth = await api('POST', `/api/imports/${importId}/commit`, { body: { period_start_date: '2026-01-01', period_end_date: '2026-01-31' } });
const salesCommit = await api('POST', `/api/imports/${importId}/commit`, { body: { period_start_date: '2026-01-01', period_end_date: '2026-01-31' }, cookie: sales.cookie });
const mgrCommit = await api('POST', `/api/imports/${importId}/commit`, { body: { period_start_date: '2026-01-01', period_end_date: '2026-01-31' }, cookie: manager.cookie });
log('--- AUTHZ ---');
log('unauthenticated commit =', noAuth.status, '(expect 401)');
log('sales (no commit perm) =', salesCommit.status, '(expect 403)');
log('manager (not owner/admin) =', mgrCommit.status, '(expect 403)');

// ---------- STEP 10: MASTER DATA LIST/SEARCH ----------
const brandsList = await api('GET', '/api/brands?q=Verification', { cookie: admin.cookie });
const prodList = await api('GET', '/api/products?q=Test%20Brand%20Product', { cookie: admin.cookie });
const varList = await api('GET', '/api/product-variants?q=Test%20Brand%20Product', { cookie: admin.cookie });
log('--- MASTER LIST ---');
log('brands list count =', brandsList.json.brands?.length);
log('products list count =', prodList.json.products?.length);
log('variants list count =', varList.json.variants?.length);

// ---------- STEP 11: STATEMENTS + DASHBOARD ----------
const stmts = await api('GET', '/api/statements', { cookie: admin.cookie });
const stmtDetail = await api('GET', `/api/statements/${statementId}`, { cookie: admin.cookie });
const dash = await api('GET', '/api/dashboard', { cookie: admin.cookie });
log('--- STATEMENTS/DASHBOARD ---');
log('statements list total =', stmts.json.pagination?.totalCount);
log('statement detail status =', stmtDetail.json.statement?.status, 'rows =', stmtDetail.json.statement?.row_count);
log('dashboard totalSalesValue =', dash.json.metrics?.totalSalesValue, 'totalStatements =', dash.json.metrics?.totalStatements);

// Save ids for cleanup
fs.writeFileSync('verify_cleanup.json', JSON.stringify({ importId, statementId, brandId, productId, variantId }));
log('SAVED cleanup ids');

await prisma.$disconnect();

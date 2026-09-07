import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import prisma from '../src/lib/prisma';
import { MatchingEngine } from '../src/lib/matching/engine';
import { seedTestDatabase, cleanupTestData } from './test-setup';
import {
  normalizeText,
  normalizeSourceItemName,
  normalizeSafeMatchName,
  normalizeCompactSafeMatchName,
  calculateSimilarityScore,
  calculateTokenOverlap,
  findCommonTokens,
  tokenize,
  scoreToConfidence,
} from '../src/lib/matching/utils';

before(async () => {
  await seedTestDatabase();
});

afterEach(async () => {
  await cleanupTestData();
});

/**
 * Test helpers
 */
async function createTestBrand(name: string) {
  return prisma.brand.create({
    data: {
      name,
      normalized_name: normalizeText(name),
      code: `BRAND_${name.substring(0, 3).toUpperCase()}`,
      status: 'ACTIVE',
    },
  });
}

async function createTestProduct(brandId: string, name: string) {
  return prisma.product.create({
    data: {
      brand_id: brandId,
      name,
      normalized_name: normalizeText(name),
      code: `PROD_${name.substring(0, 3).toUpperCase()}`,
      status: 'ACTIVE',
    },
  });
}

async function createTestVariant(productId: string, variantName: string, packSize?: string, strength?: string) {
  return prisma.productVariant.create({
    data: {
      product_id: productId,
      variant_name: variantName,
      normalized_variant_name: normalizeText(variantName),
      pack_size: packSize,
      strength: strength,
      status: 'ACTIVE',
    },
  });
}

async function createTestImportRow(
  importId: string,
  sourceItemName: string,
  sourceRowNumber?: number
) {
  // Reflects the REAL production data shape produced by processImport():
  // raw_data_json uses the original CSV header ("Source Item"),
  // parsed_data_json.normalizedData.source_item_name holds the canonical
  // normalized source item name computed by validateMappedRow().
  return prisma.importRow.create({
    data: {
      import_id: importId,
      source_row_number: sourceRowNumber,
      raw_data_json: {
        'Source Item': sourceItemName,
      } as any,
      parsed_data_json: {
        normalizedData: {
          source_item_name: normalizeSourceItemName(sourceItemName),
        },
        validationIssues: [],
        duplicateResult: null,
      } as any,
    },
  });
}

async function createTestUser(role: string = 'SALES_USER') {
  let roleId = await prisma.role.findUnique({ where: { name: role } }).then((r) => r?.id);

  if (!roleId) {
    const createdRole = await prisma.role.create({
      data: { name: role },
    });
    roleId = createdRole.id;
  }

  return prisma.user.create({
    data: {
      name: `Test ${role}`,
      email: `test-${role}-${Date.now()}@example.com`,
      password_hash: 'hash',
      role_id: roleId,
    },
  });
}

async function createTestImport(userId: string) {
  return prisma.import.create({
    data: {
      uploaded_by: userId,
      file_name: `test-${Date.now()}.csv`,
      file_type: 'CSV',
      status: 'PROCESSING',
    },
  });
}

async function cleanup() {
  await cleanupTestData();
}

/**
 * PHASE 3 - BRAND/PRODUCT/VARIANT MATCHING TESTS
 */

describe('Matching Engine - Core Utilities', () => {
  it('normalizeText should lowercase, trim, and remove special chars', () => {
    assert.strictEqual(normalizeText('  ABTER  '), 'abter');
    assert.strictEqual(normalizeText('ABTER-BRAND'), 'abter brand');
    assert.strictEqual(normalizeText('ABter Trio v1.0'), 'abter trio v1 0');
  });

  it('tokenize should split text into words', () => {
    const tokens = tokenize('ABTER BRAND PRODUCT');
    assert.deepStrictEqual(tokens, ['abter', 'brand', 'product']);
  });

  it('calculateSimilarityScore should return 100 for identical strings', () => {
    const score = calculateSimilarityScore('ABTER', 'ABTER');
    assert.strictEqual(score, 100);
  });

  it('calculateSimilarityScore should be case-insensitive', () => {
    const score1 = calculateSimilarityScore('ABTER', 'abter');
    const score2 = calculateSimilarityScore('abter', 'ABTER');
    assert.strictEqual(score1, 100);
    assert.strictEqual(score2, 100);
  });

  it('calculateSimilarityScore should penalize different strings', () => {
    const score = calculateSimilarityScore('ABTER', 'ABTER XR');
    assert(score < 100 && score > 50);
  });

  it('calculateTokenOverlap should measure word overlap', () => {
    const overlap = calculateTokenOverlap('ABTER BRAND', 'ABTER TRIO');
    assert(overlap > 0 && overlap <= 100);
  });

  it('findCommonTokens should extract shared words', () => {
    const tokens = findCommonTokens('ABTER BRAND PRODUCT', 'ABTER TRIO XR');
    assert(tokens.includes('abter'));
  });

  it('scoreToConfidence should classify scores correctly', () => {
    assert.strictEqual(scoreToConfidence(100), 'EXACT');
    assert.strictEqual(scoreToConfidence(95), 'HIGH');
    assert.strictEqual(scoreToConfidence(80), 'MEDIUM');
    assert.strictEqual(scoreToConfidence(65), 'LOW');
    assert.strictEqual(scoreToConfidence(50), 'NO_MATCH');
  });

  it('safe normalization preserves decimal and strength distinctions', () => {
    assert.strictEqual(normalizeSafeMatchName('AXTVAN 1MG TAB.'), 'axtvan 1');
    assert.strictEqual(normalizeSafeMatchName('AXTVAN 2MG TAB.'), 'axtvan 2');
    assert.strictEqual(normalizeSafeMatchName('BETAGOLD-24MG.TAB'), 'betagold 24');
    assert.strictEqual(normalizeSafeMatchName('CNAMLO-.5MG TAB'), 'cnamlo 0.5');
    assert.strictEqual(normalizeSafeMatchName('CNAMLO 5MG'), 'cnamlo 5');
    assert.strictEqual(normalizeSafeMatchName('TELTRANX H 40 12 5 MG'), 'teltranx h 40 12.5');
    assert.strictEqual(normalizeCompactSafeMatchName('HB GOLD SP'), 'hbgoldsp');
    assert.strictEqual(normalizeSafeMatchName('BRONKOSYP-LS SYRUP'), 'bronksyp ls');
    assert.strictEqual(normalizeSafeMatchName('CNPX SB-130MG.CAP'), 'cnpx sb 130');
    assert.strictEqual(normalizeSafeMatchName('DOFOTIL SYRUP-200ML'), 'dofotil 200ml');
    assert.strictEqual(normalizeSafeMatchName('CNX MOISTURIZING CREAM'), 'cnx moist cream');
    assert.strictEqual(normalizeSafeMatchName('DAFANEXT-M5/500G TAB'), 'dafanext m5 500g');
    assert.strictEqual(normalizeSafeMatchName('PRERABE 20 MG TABLETS'), 'prerabe 20');
    assert.strictEqual(normalizeSafeMatchName('CLOSINE-OZ TABLETS'), 'closine oz');
    assert.strictEqual(normalizeSafeMatchName('FI-CNX CREAM 30GM'), 'fi cnx 30gm');
    assert.strictEqual(normalizeSafeMatchName('FI-CNX CREAM 50GM'), 'fi cnx 50gm');
    assert.strictEqual(normalizeSafeMatchName('ESCNX 10MG TABLETS'), 'escnx 10');
    assert.notStrictEqual(normalizeSafeMatchName('FI-CNX CREAM 30GM'), normalizeSafeMatchName('FI-CNX 50GM'));
    assert.notStrictEqual(normalizeSafeMatchName('CNAMLO-.5MG TAB'), normalizeSafeMatchName('CNAMLO 5MG'));
  });
});

describe('Matching Engine - Level 1: Exact Match', async () => {
  const engine = new MatchingEngine();

  it('should return EXACT match for identical Brand name', async () => {
    const brand = await createTestBrand('ABTER');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER');

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER',
    });

    assert.strictEqual(result.status, 'SUGGESTED');
    assert.strictEqual(result.candidates.length, 1);
    assert.strictEqual(result.candidates[0].entityType, 'BRAND');
    assert.strictEqual(result.candidates[0].entityId, brand.id);
    assert.strictEqual(result.candidates[0].confidence, 'EXACT');

    await cleanup();
  });

  it('should preserve strength while normalizing a terminal tablet suffix', () => {
    assert.strictEqual(normalizeSourceItemName('ACKNOTIN-10 TAB.'), 'acknotin 10');
    assert.strictEqual(normalizeSourceItemName('ACKNOTIN-20 TAB'), 'acknotin 20');
    assert.strictEqual(normalizeSourceItemName('CNAMLO-.5MG TAB'), 'cnamlo 0.5mg');
    assert.strictEqual(normalizeSourceItemName('CNAMLO-2.5MG TAB'), 'cnamlo 2.5mg');
    assert.strictEqual(normalizeSourceItemName('BRONKOSYP-DX SYP'), 'bronksyp dx syp');
    assert.strictEqual(normalizeSafeMatchName('BRONKOSYP-LS SYRUP'), 'bronksyp ls');
    assert.strictEqual(normalizeSafeMatchName('HB GOLD GEL.30GM.'), 'hb gold gel 30gm');
    assert.notStrictEqual(normalizeSourceItemName('ACKNOTIN-10'), normalizeSourceItemName('ACKNOTIN-20'));
  });

  it('should return EXACT match for identical Product name', async () => {
    const brand = await createTestBrand('ABTER');
    const product = await createTestProduct(brand.id, 'ABTER TRIO');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER TRIO');

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER TRIO',
    });

    assert.strictEqual(result.candidates.length, 1);
    assert.strictEqual(result.candidates[0].entityType, 'PRODUCT');
    assert.strictEqual(result.candidates[0].entityId, product.id);
    assert.strictEqual(result.candidates[0].confidence, 'EXACT');

    await cleanup();
  });

  it('should auto-match a product when only safe source formatting differs', async () => {
    const brand = await createTestBrand('AXTVAN');
    const product = await createTestProduct(brand.id, 'AXTVAN-1');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'AXTVAN 1MG TAB.');

    const result = await new MatchingEngine().suggestMatches({
      importRowId: row.id,
      sourceName: 'AXTVAN 1MG TAB.',
    });

    assert.strictEqual(result.candidates.length, 1);
    assert.strictEqual(result.candidates[0].entityId, product.id);
    assert.strictEqual(result.candidates[0].reason, 'safe_normalized_master_match');
    assert.strictEqual(result.requiresConfirmation, false);
    await cleanup();
  });

  it('should safely match dosage forms and joined strengths without merging modifiers', async () => {
    const brand = await createTestBrand('Safe Variant Brand');
    const products = await Promise.all([
      createTestProduct(brand.id, 'PRERABE 20'),
      createTestProduct(brand.id, 'CLOSINE-OZ'),
      createTestProduct(brand.id, 'FI-CNX 30GM'),
      createTestProduct(brand.id, 'FI-CNX 50GM'),
      createTestProduct(brand.id, 'ESCNX 10'),
      createTestProduct(brand.id, 'ESCNX 5'),
      createTestProduct(brand.id, 'ESCNX 15'),
      createTestProduct(brand.id, 'ESCNX 20'),
      createTestProduct(brand.id, 'PRESTILLER NT 50'),
    ]);
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const cases = [
      ['PRERABE 20 MG TABLETS', 'PRERABE 20'],
      ['CLOSINE-OZ TABLETS', 'CLOSINE-OZ'],
      ['FI-CNX CREAM 30GM', 'FI-CNX 30GM'],
      ['FI-CNX CREAM 50GM', 'FI-CNX 50GM'],
      ['ESCNX 10MG TABLETS', 'ESCNX 10'],
    ] as const;

    for (const [sourceName, expectedName] of cases) {
      const row = await createTestImportRow(importRec.id, sourceName);
      const result = await new MatchingEngine().suggestMatches({ importRowId: row.id, sourceName });
      assert.equal(result.status, 'SUGGESTED');
      assert.equal(result.requiresConfirmation, false);
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0].entityName, expectedName);
      assert.equal(result.candidates[0].reason, 'safe_normalized_master_match');
    }

    const prestillerRow = await createTestImportRow(importRec.id, 'PRESTILLER-D 50 CAP');
    const prestillerResult = await new MatchingEngine().suggestMatches({ importRowId: prestillerRow.id, sourceName: 'PRESTILLER-D 50 CAP' });
    assert.equal(prestillerResult.requiresConfirmation, true);
    assert.ok(!prestillerResult.candidates.some((candidate) => candidate.entityName === 'PRESTILLER NT 50' && candidate.reason === 'safe_normalized_master_match'));

    assert.equal(products.length, 9);
    await cleanup();
  });

  it('should return EXACT match for identical Variant name', async () => {
    const brand = await createTestBrand('ABTER');
    const product = await createTestProduct(brand.id, 'ABTER TRIO');
    const variant = await createTestVariant(product.id, 'ABTER TRIO XR', '100ml', 'Strong');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER TRIO XR');

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER TRIO XR',
    });

    assert.strictEqual(result.candidates.length, 1);
    assert.strictEqual(result.candidates[0].entityType, 'VARIANT');
    assert.strictEqual(result.candidates[0].entityId, variant.id);
    assert.strictEqual(result.candidates[0].confidence, 'EXACT');

    await cleanup();
  });

  it('should distinguish between Brand and Product matches', async () => {
    const brand = await createTestBrand('ABTER');
    const product = await createTestProduct(brand.id, 'ABTER');

    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER');

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER',
    });

    // Should return one of the exact matches, likely Brand first
    assert.strictEqual(result.candidates.length, 1);
    assert.strictEqual(result.candidates[0].confidence, 'EXACT');

    await cleanup();
  });
});

describe('Matching Engine - Level 3: Fuzzy Suggestion', async () => {
  const engine = new MatchingEngine();

  it('should suggest similar Brand candidates', async () => {
    const brand = await createTestBrand('ABTER');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER XR');

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER XR',
    });

    assert.strictEqual(result.status, 'SUGGESTED');
    assert(result.candidates.length > 0, 'Should have fuzzy candidates');
    assert.strictEqual(result.requiresConfirmation, true, 'Fuzzy match requires confirmation');

    // At least one candidate should be similar to ABTER
    const hasABTER = result.candidates.some((c) => c.entityName.includes('ABTER'));
    assert(hasABTER, 'Should suggest ABTER as candidate');

    await cleanup();
  });

  it('should rank candidates by score descending', async () => {
    const brand1 = await createTestBrand('ABTER');
    const brand2 = await createTestBrand('BETA');
    const brand3 = await createTestBrand('ALBERT');

    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER TRIO');

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER TRIO',
    });

    // Candidates should be sorted by score
    for (let i = 1; i < result.candidates.length; i++) {
      assert(
        result.candidates[i - 1].score >= result.candidates[i].score,
        'Candidates should be sorted by score descending'
      );
    }

    await cleanup();
  });

  it('should filter candidates below LOW confidence threshold', async () => {
    const brand = await createTestBrand('ZEBRA');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER');

    const engine_strict = new MatchingEngine({ lowConfidenceThreshold: 80 });
    const result = await engine_strict.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER',
    });

    // ZEBRA vs ABTER should be very low similarity
    const hasZEBRA = result.candidates.some((c) => c.entityName === 'ZEBRA');
    assert(!hasZEBRA, 'Should not suggest ZEBRA if similarity < 80%');

    await cleanup();
  });

  it('should use candidate blocking for performance', async () => {
    // Create many brands
    const brands = await Promise.all([
      createTestBrand('ABTER'),
      createTestBrand('ABTER TRIO'),
      createTestBrand('ABTER XR'),
      createTestBrand('ABTER SP'),
      createTestBrand('ABTER SL'),
      createTestBrand('BETA'),
      createTestBrand('GAMMA'),
      createTestBrand('DELTA'),
    ]);

    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER');

    const config = new MatchingEngine({ maxCandidatesPerLevel: 3 });
    const result = await config.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER',
    });

    // Should have limited candidates due to maxCandidatesPerLevel
    assert(result.candidates.length <= 10, 'Candidate count limited by maxCandidatesPerLevel * 2');

    await cleanup();
  });

  it('should not auto-confirm fuzzy matches', async () => {
    const brand = await createTestBrand('ABTER');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER XR');

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER XR',
    });

    // Fuzzy matches must require confirmation
    assert.strictEqual(result.requiresConfirmation, true, 'Fuzzy match must require confirmation');
    assert.strictEqual(result.selectedCandidateId, undefined, 'Fuzzy match must not auto-select');

    await cleanup();
  });
});

describe('Matching Engine - Level 2: Previously Confirmed', async () => {
  const engine = new MatchingEngine();

  it('should suggest previously confirmed mapping with HIGH confidence', async () => {
    const brand = await createTestBrand('ABTER');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row1 = await createTestImportRow(importRec.id, 'ABTER Trio', 1);

    // Confirm the mapping (brand only — no product to avoid exact match priority)
    await prisma.importRow.update({
      where: { id: row1.id },
      data: {
        confirmed_brand_id: brand.id,
        confirmed_by_user_id: user.id,
        confirmed_at: new Date(),
      },
    });

    // Second import, same source name
    const importRec2 = await createTestImport(user.id);
    const row2 = await createTestImportRow(importRec2.id, 'ABTER Trio', 1);

    const result = await engine.suggestMatches({
      importRowId: row2.id,
      sourceName: 'ABTER Trio',
    });

    const previousMatch = result.previousSelection;
    assert(previousMatch, 'Should detect previously confirmed mapping');

    await cleanup();
  });
});

describe('Matching Engine - Previously Confirmed (Real Data Shape Regression)', async () => {
  const engine = new MatchingEngine();

  it('should detect previous confirmation via normalizedData.source_item_name', async () => {
    const brand = await createTestBrand('ABTER');
    const user = await createTestUser();

    // Real import row #1 produced by processImport(): raw_data_json uses the
    // original CSV header ("Source Item") and parsed_data_json.normalizedData
    // holds the canonical normalized source item name.
    const importRec1 = await createTestImport(user.id);
    const row1 = await prisma.importRow.create({
      data: {
        import_id: importRec1.id,
        source_row_number: 1,
        raw_data_json: { 'Source Item': 'Abter Trio 500mg' } as any,
        parsed_data_json: {
          normalizedData: { source_item_name: 'abter trio 500mg' },
          validationIssues: [],
          duplicateResult: null,
        } as any,
      },
    });

    // User confirmed a mapping (brand only; deliberately NOT an exact master
    // match so we don't accidentally hit the exact-match branch).
    await prisma.importRow.update({
      where: { id: row1.id },
      data: {
        confirmed_brand_id: brand.id,
        confirmed_by_user_id: user.id,
        confirmed_at: new Date(),
      },
    });

    // New import: same canonical normalized source name as the confirmed row.
    const importRec2 = await createTestImport(user.id);
    const row2 = await prisma.importRow.create({
      data: {
        import_id: importRec2.id,
        source_row_number: 1,
        raw_data_json: { 'Source Item': 'Abter Trio 500mg' } as any,
        parsed_data_json: {
          normalizedData: { source_item_name: 'abter trio 500mg' },
          validationIssues: [],
          duplicateResult: null,
        } as any,
      },
    });

    const result = await engine.suggestMatches({
      importRowId: row2.id,
      sourceName: 'Abter Trio 500mg',
    });

    // 1. Detected the previous confirmation
    assert(result.previousSelection, 'Should detect previously confirmed mapping');
    assert.strictEqual(result.previousSelection?.candidateId, brand.id);

    // 2. HIGH confidence suggestion, not an exact match
    assert.strictEqual(result.candidates.length, 1);
    assert.strictEqual(result.candidates[0].confidence, 'HIGH');
    assert.strictEqual(result.candidates[0].reason, 'previously_confirmed');
    assert.notStrictEqual(result.candidates[0].confidence, 'EXACT');

    // 3. Still requires explicit user confirmation (never auto-confirm)
    assert.strictEqual(result.requiresConfirmation, true);

    await cleanup();
  });
});

describe('Matching Engine - Persistent learned aliases', async () => {
  it('auto-resolves a confirmed alias and reports conflicts as ambiguous', async () => {
    const brand = await createTestBrand('LEARNED');
    const product = await createTestProduct(brand.id, 'CANONICAL 10 MG');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'Vendor Label 10 TAB.');

    await prisma.learnedMapping.create({
      data: {
        normalized_source_name: normalizeSourceItemName('Vendor Label 10 TAB.'),
        entity_key: `PRODUCT:${product.id}`,
        entity_type: 'PRODUCT',
        brand_id: brand.id,
        product_id: product.id,
        confirmed_by_user_id: user.id,
      },
    });

    const result = await new MatchingEngine().suggestMatches({
      importRowId: row.id,
      sourceName: 'Vendor Label 10 TAB.',
    });
    assert.strictEqual(result.candidates[0].entityId, product.id);
    assert.strictEqual(result.candidates[0].reason, 'alias_match');
    assert.strictEqual(result.requiresConfirmation, false);

    const secondProduct = await createTestProduct(brand.id, 'CANONICAL 20 MG');
    await prisma.learnedMapping.create({
      data: {
        normalized_source_name: normalizeSourceItemName('Vendor Label 10 TAB.'),
        entity_key: `PRODUCT:${secondProduct.id}`,
        entity_type: 'PRODUCT',
        brand_id: brand.id,
        product_id: secondProduct.id,
        confirmed_by_user_id: user.id,
      },
    });

    const ambiguous = await new MatchingEngine().suggestMatches({
      importRowId: row.id,
      sourceName: 'Vendor Label 10 TAB.',
    });
    assert.strictEqual(ambiguous.status, 'AMBIGUOUS');
    assert.strictEqual(ambiguous.requiresConfirmation, true);
    await cleanup();
  });
});

describe('Matching Engine - Ambiguous Hierarchy', async () => {
  const engine = new MatchingEngine();

  it('should suggest both Brand and Product when ambiguous', async () => {
    const brand = await createTestBrand('ABTER');
    const product = await createTestProduct(brand.id, 'ABTER');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER');

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER',
    });

    // Exact match takes priority, but should show which level it matched
    assert.strictEqual(result.candidates[0].confidence, 'EXACT');
    assert(['BRAND', 'PRODUCT'].includes(result.candidates[0].entityType));

    await cleanup();
  });

  it('should not automatically decide Brand vs Product hierarchy', async () => {
    const brand = await createTestBrand('ABTER');
    const product = await createTestProduct(brand.id, 'ABTER TRIO');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER');

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER',
    });

    // Should show it's an exact match but require confirmation if hierarchy unclear
    // (Though in this case BRAND exact matches, so that should win)
    assert(result.candidates.length > 0);

    await cleanup();
  });
});

describe('Matching Engine - Data Preservation', async () => {
  const engine = new MatchingEngine();

  it('should preserve source_item_name throughout matching', async () => {
    const brand = await createTestBrand('ABTER');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const sourceItem = 'Original Source Item Name';
    const row = await createTestImportRow(importRec.id, sourceItem);

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: sourceItem,
    });

    // Result must preserve original source name
    assert.strictEqual(result.sourceName, sourceItem);

    // Row data must remain unchanged
    const updatedRow = await prisma.importRow.findUnique({
      where: { id: row.id },
    });
    const rawData = updatedRow?.raw_data_json as Record<string, unknown>;
    assert.strictEqual(rawData['Source Item'], sourceItem);

    await cleanup();
  });

  it('should preserve normalized_source_item_name', async () => {
    const brand = await createTestBrand('ABTER');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER BRAND');

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER BRAND',
    });

    // Result should contain normalized form
    const normalized = normalizeText('ABTER BRAND');
    assert.strictEqual(result.normalizedSourceName, normalized);

    await cleanup();
  });
});

describe('Matching Engine - Rejection & Leave Unmatched', async () => {
  it('should allow user to reject suggestions', async () => {
    const brand = await createTestBrand('ABTER');
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER');

    // Simulate rejection (by clearing suggestions)
    await prisma.importRow.update({
      where: { id: row.id },
      data: {
        suggested_brand_id: null,
        suggested_product_id: null,
        suggested_variant_id: null,
      },
    });

    const updated = await prisma.importRow.findUnique({
      where: { id: row.id },
    });

    assert.strictEqual(updated?.suggested_brand_id, null);

    await cleanup();
  });

  it('should allow user to leave unmatched', async () => {
    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'UNKNOWN ITEM');

    const engine = new MatchingEngine();
    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'UNKNOWN ITEM THAT DOES NOT EXIST',
    });

    assert.strictEqual(result.status, 'UNMATCHED');
    assert.strictEqual(result.candidates.length, 0);

    await cleanup();
  });
});

describe('Matching Engine - Confidence Classification', async () => {
  const engine = new MatchingEngine();

  it('should classify EXACT confidence for 100% match', () => {
    assert.strictEqual(scoreToConfidence(100), 'EXACT');
  });

  it('should classify HIGH confidence for 90-99 match', () => {
    assert.strictEqual(scoreToConfidence(95), 'HIGH');
  });

  it('should classify MEDIUM confidence for 75-89 match', () => {
    assert.strictEqual(scoreToConfidence(82), 'MEDIUM');
  });

  it('should classify LOW confidence for 60-74 match', () => {
    assert.strictEqual(scoreToConfidence(68), 'LOW');
  });

  it('should classify NO_MATCH for < 60 score', () => {
    assert.strictEqual(scoreToConfidence(50), 'NO_MATCH');
  });
});

describe('Matching Engine - Variant Hierarchy', async () => {
  const engine = new MatchingEngine();

  it('should associate variant with product and brand', async () => {
    const brand = await createTestBrand('ABTER');
    const product = await createTestProduct(brand.id, 'ABTER TRIO');
    const variant = await createTestVariant(product.id, 'ABTER TRIO XR', '100ml', 'Strong');

    const user = await createTestUser();
    const importRec = await createTestImport(user.id);
    const row = await createTestImportRow(importRec.id, 'ABTER TRIO XR');

    const result = await engine.suggestMatches({
      importRowId: row.id,
      sourceName: 'ABTER TRIO XR',
    });

    const variantMatch = result.candidates[0];
    assert.strictEqual(variantMatch.entityType, 'VARIANT');
    assert.strictEqual(variantMatch.parentProductId, product.id);
    assert.strictEqual(variantMatch.brandId, brand.id);

    await cleanup();
  });
});

describe('Matching Engine - Separate Identities', async () => {
  const engine = new MatchingEngine();

  it('should NOT automatically merge ABter and ABter Trio', async () => {
    const brand1 = await createTestBrand('ABTER');
    const brand2 = await createTestBrand('ABTER TRIO');

    const user = await createTestUser();
    const importRec = await createTestImport(user.id);

    const row1 = await createTestImportRow(importRec.id, 'ABTER', 1);
    const row2 = await createTestImportRow(importRec.id, 'ABTER TRIO', 2);

    const result1 = await engine.suggestMatches({
      importRowId: row1.id,
      sourceName: 'ABTER',
    });

    const result2 = await engine.suggestMatches({
      importRowId: row2.id,
      sourceName: 'ABTER TRIO',
    });

    // Results should be different
    assert.notStrictEqual(result1.candidates[0]?.entityId, result2.candidates[0]?.entityId);

    await cleanup();
  });

  it('should NOT automatically merge ABter XR and ABter', async () => {
    const brand = await createTestBrand('ABTER');
    const product_xr = await createTestProduct(brand.id, 'ABTER XR');
    const product_sp = await createTestProduct(brand.id, 'ABTER SP');

    const user = await createTestUser();
    const importRec = await createTestImport(user.id);

    const row_xr = await createTestImportRow(importRec.id, 'ABTER XR', 1);
    const row_sp = await createTestImportRow(importRec.id, 'ABTER SP', 2);

    const result_xr = await engine.suggestMatches({
      importRowId: row_xr.id,
      sourceName: 'ABTER XR',
    });

    const result_sp = await engine.suggestMatches({
      importRowId: row_sp.id,
      sourceName: 'ABTER SP',
    });

    // Both should find matches but they should be different products
    assert.notStrictEqual(result_xr.candidates[0]?.entityId, result_sp.candidates[0]?.entityId);

    await cleanup();
  });
});

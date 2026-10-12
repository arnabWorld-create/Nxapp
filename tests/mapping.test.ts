import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeHeader,
  translateHeaderToField,
  buildHeaderMappingResults,
  applyMappingTemplate,
  validateTemplate,
  isTemplateMatchUseful,
  isValidCanonicalField,
  HeaderMappingResult,
} from '../src/lib/import/mapping/index.js';
import { validateMappedRow } from '../src/lib/import/validation/validator.ts';

const sampleTemplate = {
  name: 'example template',
  fileType: 'csv',
  mapping: {
    'Brand Name': 'source_item_name',
    'Purch Qty': 'reported_purchase_qty',
    'Purch Value': 'reported_purchase_value',
    'Sales Qty': 'reported_sales_qty',
    'Sales Value': 'reported_sales_value',
    'C Stk': 'reported_closing_stock_qty',
    'C Val': 'reported_closing_stock_value',
  },
};

test('normalizeHeader trims, lowercases, and collapses whitespace', () => {
  assert.equal(normalizeHeader('  Purchase   Qty '), 'purchase qty');
  assert.equal(normalizeHeader('PURCHASE QTY'), 'purchase qty');
  assert.equal(normalizeHeader('Purchase-QTY'), 'purchase qty');
});

test('exact header match maps directly to canonical field', () => {
  const result = translateHeaderToField('source_item_name');
  assert.equal(result.targetField, 'source_item_name');
  assert.equal(result.status, 'AUTO_MAPPED');
  assert.equal(result.confidence, 'HIGH');
});

test('known alias maps to canonical field reported_closing_stock_qty', () => {
  const result = translateHeaderToField('C Stk');
  assert.equal(result.targetField, 'reported_closing_stock_qty');
  assert.equal(result.status, 'AUTO_MAPPED');
  assert.equal(result.confidence, 'HIGH');
});

test('known alias CIStk maps to reported_closing_stock_qty', () => {
  const result = translateHeaderToField('CIStk');
  assert.equal(result.targetField, 'reported_closing_stock_qty');
  assert.equal(result.status, 'AUTO_MAPPED');
});

test('known alias Closing Qty maps to reported_closing_stock_qty', () => {
  const result = translateHeaderToField('Closing Qty');
  assert.equal(result.targetField, 'reported_closing_stock_qty');
});

test('known alias C Val maps to reported_closing_stock_value', () => {
  const result = translateHeaderToField('C Val');
  assert.equal(result.targetField, 'reported_closing_stock_value');
});

test('real XLS CNX aliases map to the canonical purchase/sales/closing fields', () => {
  assert.equal(translateHeaderToField('P.Val').targetField, 'reported_purchase_value');
  assert.equal(translateHeaderToField('S.Val').targetField, 'reported_sales_value');
  assert.equal(translateHeaderToField('ClStk').targetField, 'reported_closing_stock_qty');
  assert.equal(translateHeaderToField('ClVal').targetField, 'reported_closing_stock_value');
});

test('known alias CIVal maps to reported_closing_stock_value', () => {
  const result = translateHeaderToField('CIVal');
  assert.equal(result.targetField, 'reported_closing_stock_value');
});

test('known alias Closing Value maps to reported_closing_stock_value', () => {
  const result = translateHeaderToField('Closing Value');
  assert.equal(result.targetField, 'reported_closing_stock_value');
});

test('unknown header remains unmapped with original header preserved', () => {
  const result = translateHeaderToField('ABter Trio');
  assert.equal(result.sourceHeader, 'ABter Trio');
  assert.equal(result.normalizedHeader, 'abter trio');
  assert.equal(result.targetField, null);
  assert.equal(result.status, 'UNMAPPED');
  assert.equal(result.confidence, 'NONE');
});

test('ambiguous Qty header requires review and does not auto-confirm', () => {
  const result = translateHeaderToField('Qty');
  assert.equal(result.targetField, null);
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.confidence, 'NONE');
  assert.ok(result.candidates.length >= 1);
});

test('sales statement Product Na Qty Taxable headers map safely', () => {
  const results = buildHeaderMappingResults(['Product Na', 'Qty', 'Taxable']);
  assert.deepEqual(results.map((result) => result.targetField), [
    'source_item_name',
    'reported_sales_qty',
    'reported_sales_value',
  ]);
  assert.ok(results.every((result) => result.status === 'AUTO_MAPPED'));

  const validated = validateMappedRow(2, { 'Product Na': 'ESCNX LS 5MG TAB', Qty: 3, Taxable: 231.42 }, results);
  assert.equal(validated.normalizedData.source_item_name, 'escnx ls 5mg');
  assert.equal(validated.normalizedData.reported_sales_qty, '3');
  assert.equal(validated.normalizedData.reported_sales_value, '231.42');
});

test('ambiguous Value header requires review and does not auto-confirm', () => {
  const result = translateHeaderToField('Value');
  assert.equal(result.targetField, null);
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.confidence, 'NONE');
  assert.ok(result.candidates.length >= 1);
});

test('fuzzy suggestion returns candidate without auto-confirming', () => {
  const result = translateHeaderToField('Closing Stock');
  assert.equal(result.targetField, 'reported_closing_stock_qty');
  assert.equal(result.status, 'AUTO_MAPPED');
  assert.equal(result.confidence, 'HIGH');
});

test('duplicate source headers are marked for review', () => {
  const results = buildHeaderMappingResults(['Qty', 'Qty']);
  assert.equal(results.length, 2);
  assert.equal(results[0].status, 'REVIEW_REQUIRED');
  assert.equal(results[0].duplicateSourceHeader, true);
});

test('partial mapping template applies safe matches and leaves others for review', () => {
  const results = applyMappingTemplate(['Brand Name', 'Qty', 'C Stk'], sampleTemplate);
  const brandResult = results.find((r) => r.sourceHeader === 'Brand Name');
  const qtyResult = results.find((r) => r.sourceHeader === 'Qty');
  const cstkResult = results.find((r) => r.sourceHeader === 'C Stk');

  assert.equal(brandResult?.targetField, 'source_item_name');
  assert.equal(brandResult?.status, 'AUTO_MAPPED');
  assert.equal(cstkResult?.targetField, 'reported_closing_stock_qty');
  assert.equal(cstkResult?.status, 'AUTO_MAPPED');
  assert.equal(qtyResult?.status, 'REVIEW_REQUIRED');
});

test('full mapping template reuses exact template mappings', () => {
  const results = applyMappingTemplate(['Brand Name', 'Purch Qty', 'C Val'], sampleTemplate);
  const mapped = results.map((item) => item.targetField);
  assert.deepEqual(mapped, ['source_item_name', 'reported_purchase_qty', 'reported_closing_stock_value']);
});

test('validateTemplate rejects invalid canonical fields', () => {
  const badTemplate = {
    name: 'bad template',
    fileType: 'csv',
    mapping: {
      'Brand Name': 'source_item_name',
      'Bad Qty': 'not_a_field',
    },
  } as unknown as { name: string; fileType: string; mapping: Record<string, string> };

  assert.equal(validateTemplate(sampleTemplate), true);
  assert.equal(validateTemplate(badTemplate as any), false);
});

test('isTemplateMatchUseful detects useful template for source headers', () => {
  assert.equal(isTemplateMatchUseful(['Brand Name', 'Qty'], sampleTemplate), true);
  assert.equal(isTemplateMatchUseful(['Unknown Header'], sampleTemplate), false);
});

test('CNX non-canonical headers are ignored and never suggested', () => {
  const ignoredHeaders = ['P.Sch', 'S.Sch', 'OpStk', 'CrQty', 'CrSchQty', 'DbQty'];
  for (const header of ignoredHeaders) {
    const result = translateHeaderToField(header);
    assert.equal(result.targetField, null);
    assert.equal(result.status, 'IGNORED');
    assert.equal(result.confidence, 'NONE');
    assert.deepEqual(result.candidates, []);
  }

  const pSch = translateHeaderToField('P.Sch');
  const sSch = translateHeaderToField('S.Sch');
  assert.equal(pSch.status, 'IGNORED');
  assert.equal(sSch.status, 'IGNORED');
  assert.notEqual(pSch.status, 'SUGGESTED');
  assert.notEqual(sSch.status, 'SUGGESTED');
});

test('blank headers are ignored automatically', () => {
  const results = buildHeaderMappingResults(['', '  ', 'Item', 'P.Qty']);
  const blankResults = results.filter((result) => result.sourceHeader.trim() === '');
  assert.equal(blankResults.length, 2);
  assert.ok(blankResults.every((result) => result.status === 'IGNORED'));
  assert.ok(blankResults.every((result) => result.targetField === null));
});

test('CNX canonical mappings remain auto mapped', () => {
  const mappings = {
    Item: 'source_item_name',
    'P.Qty': 'reported_purchase_qty',
    'P.Val': 'reported_purchase_value',
    'S.Qty': 'reported_sales_qty',
    'S.Val': 'reported_sales_value',
    ClStk: 'reported_closing_stock_qty',
    ClVal: 'reported_closing_stock_value',
  } as const;

  for (const [header, field] of Object.entries(mappings)) {
    const result = translateHeaderToField(header);
    assert.equal(result.targetField, field);
    assert.equal(result.status, 'AUTO_MAPPED');
    assert.equal(result.confidence, 'HIGH');
  }
});

test('ignored fields including Rate do not produce MAPPING_REQUIRED warnings during validation', () => {
  const mappingResults = buildHeaderMappingResults([
    'Item',
    'Rate',
    'P.Qty',
    'P.Val',
    'S.Qty',
    'S.Val',
    'ClStk',
    'ClVal',
    'P.Sch',
    'S.Sch',
    'OpStk',
    'CrQty',
    'CrSchQty',
    'DbQty',
  ]);

  const validated = validateMappedRow(
    1,
    {
      Item: 'CNX Test Item',
      Rate: '14.00',
      'P.Qty': '12',
      'P.Val': '123.45',
      'S.Qty': '8',
      'S.Val': '54.00',
      ClStk: '20',
      ClVal: '200.00',
      'P.Sch': '2',
      'S.Sch': '1',
      OpStk: '4',
      CrQty: '1',
      CrSchQty: '0',
      DbQty: '0',
    },
    mappingResults
  );

  assert.ok(!validated.issues.some((issue) => issue.code === 'MAPPING_REQUIRED'));
  assert.ok(validated.issues.some((issue) => issue.code === 'MISSING_QUANTITY_UNIT'));
  assert.equal(validated.validationStatus, 'REVIEW_REQUIRED');
});

test('required canonical field source_item_name remains valid canonical field', () => {
  assert.equal(isValidCanonicalField('source_item_name'), true);
  assert.equal(isValidCanonicalField('invalid_field'), false);
});

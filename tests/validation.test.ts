import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMappedRow } from '../src/lib/import/validation/index.js';
import { applyAutomaticQuantityUnit, isCnxStatementFormat } from '../src/lib/import/process';
import type { HeaderMappingResult } from '../src/lib/import/mapping/index.js';

function createMapping(header: string, field: string): HeaderMappingResult {
  return {
    sourceHeader: header,
    normalizedHeader: header.trim().toLowerCase(),
    targetField: field as any,
    confidence: 'HIGH',
    status: 'AUTO_MAPPED',
    candidates: [],
  };
}

test('valid row with all canonical fields is valid', () => {
  const rawData = {
    'Brand Name': 'ABter Trio',
    'Purch Qty': '1,250',
    'Purch Value': '₹25,000.50',
    'Sales Qty': '500',
    'Sales Value': '45,000.25',
    'Sales Return Qty': '0',
    'Sales Return Value': '0',
    'Purchase Return Qty': '0',
    'Purchase Return Value': '0',
    'C Stk': '100',
    'C Val': '₹5,000',
    'Unit': 'boxes',
  };

  const mapping: HeaderMappingResult[] = [
    createMapping('Brand Name', 'source_item_name'),
    createMapping('Purch Qty', 'reported_purchase_qty'),
    createMapping('Purch Value', 'reported_purchase_value'),
    createMapping('Sales Qty', 'reported_sales_qty'),
    createMapping('Sales Value', 'reported_sales_value'),
    createMapping('Sales Return Qty', 'reported_sales_return_qty'),
    createMapping('Sales Return Value', 'reported_sales_return_value'),
    createMapping('Purchase Return Qty', 'reported_purchase_return_qty'),
    createMapping('Purchase Return Value', 'reported_purchase_return_value'),
    createMapping('C Stk', 'reported_closing_stock_qty'),
    createMapping('C Val', 'reported_closing_stock_value'),
    createMapping('Unit', 'quantity_unit'),
  ];

  const validated = validateMappedRow(2, rawData, mapping);
  assert.equal(validated.validationStatus, 'VALID');
  assert.equal(validated.issues.length, 0);
  assert.equal(validated.normalizedData.source_item_name, 'ABter Trio');
  assert.equal(validated.normalizedData.reported_purchase_qty, '1250');
  assert.equal(validated.normalizedData.reported_purchase_value, '25000.50');
  assert.equal(validated.normalizedData.quantity_unit, 'boxes');
});

test('missing source item name is invalid', () => {
  const rawData = { 'Brand Name': '   ', 'Purch Qty': '100' };
  const mapping: HeaderMappingResult[] = [
    createMapping('Brand Name', 'source_item_name'),
    createMapping('Purch Qty', 'reported_purchase_qty'),
  ];

  const validated = validateMappedRow(3, rawData, mapping);
  assert.equal(validated.validationStatus, 'INVALID');
  assert.equal(validated.issues.some((issue) => issue.code === 'SOURCE_ITEM_NAME_REQUIRED'), true);
});

test('CNX format applies STRIP automatically without changing generic validation', () => {
  assert.equal(isCnxStatementFormat(['Item', 'P.Qty', 'P.Val', 'S.Qty', 'S.Val', 'ClStk']), true);
  assert.equal(isCnxStatementFormat(['Item', 'ClStk', 'ClVal', 'OpStk', 'S.Qty', 'S.Sch', 'S.Val']), true);
  assert.equal(isCnxStatementFormat(['source_item_name', 'reported_purchase_qty']), false);

  const validated = validateMappedRow(2, {
    Item: 'CNX Item',
    'P.Qty': '10',
    'P.Val': '100',
    'S.Qty': '',
    'S.Val': '',
    ClStk: '5',
  }, [
    createMapping('Item', 'source_item_name'),
    createMapping('P.Qty', 'reported_purchase_qty'),
    createMapping('P.Val', 'reported_purchase_value'),
    createMapping('S.Qty', 'reported_sales_qty'),
    createMapping('S.Val', 'reported_sales_value'),
    createMapping('ClStk', 'reported_closing_stock_qty'),
  ]);
  assert.equal(validated.validationStatus, 'REVIEW_REQUIRED');
  const applied = applyAutomaticQuantityUnit(validated, 'STRIP');
  assert.equal(applied.normalizedData.quantity_unit, 'STRIP');
  assert.equal(applied.validationStatus, 'VALID');
  assert.equal(applied.issues.some((issue) => issue.code === 'MISSING_QUANTITY_UNIT'), false);
});

test('invalid numeric value is invalid', () => {
  const rawData = { 'Brand Name': 'ABter Trio', 'Sales Qty': 'ABC' };
  const mapping: HeaderMappingResult[] = [
    createMapping('Brand Name', 'source_item_name'),
    createMapping('Sales Qty', 'reported_sales_qty'),
  ];

  const validated = validateMappedRow(4, rawData, mapping);
  assert.equal(validated.validationStatus, 'INVALID');
  assert.equal(validated.issues[0].code, 'INVALID_QUANTITY');
});

test('negative quantity is review required', () => {
  const rawData = { 'Brand Name': 'ABter Trio', 'Sales Qty': '-50', 'Unit': 'pcs' };
  const mapping: HeaderMappingResult[] = [
    createMapping('Brand Name', 'source_item_name'),
    createMapping('Sales Qty', 'reported_sales_qty'),
    createMapping('Unit', 'quantity_unit'),
  ];

  const validated = validateMappedRow(5, rawData, mapping);
  assert.equal(validated.validationStatus, 'REVIEW_REQUIRED');
  assert.equal(validated.issues.some((issue) => issue.code === 'NEGATIVE_QUANTITY'), true);
  assert.equal(validated.normalizedData.reported_sales_qty, '-50');
});

test('missing quantity unit with quantity triggers review required', () => {
  const rawData = { 'Brand Name': 'ABter Trio', 'Sales Qty': '100' };
  const mapping: HeaderMappingResult[] = [
    createMapping('Brand Name', 'source_item_name'),
    createMapping('Sales Qty', 'reported_sales_qty'),
  ];

  const validated = validateMappedRow(6, rawData, mapping);
  assert.equal(validated.validationStatus, 'REVIEW_REQUIRED');
  assert.equal(validated.issues.some((issue) => issue.code === 'MISSING_QUANTITY_UNIT'), true);
});

test('blank optional numeric field becomes null', () => {
  const rawData = { 'Brand Name': 'ABter Trio', 'Sales Qty': '   ', 'C Val': '' };
  const mapping: HeaderMappingResult[] = [
    createMapping('Brand Name', 'source_item_name'),
    createMapping('Sales Qty', 'reported_sales_qty'),
    createMapping('C Val', 'reported_closing_stock_value'),
  ];

  const validated = validateMappedRow(7, rawData, mapping);
  assert.equal(validated.normalizedData.reported_sales_qty, null);
  assert.equal(validated.normalizedData.reported_closing_stock_value, null);
  assert.equal(validated.validationStatus, 'VALID');
});

test('currency with symbol and spaces normalizes and preserves raw source', () => {
  const rawData = { 'Brand Name': 'ABter Trio', 'C Val': '₹ 25,000.50' };
  const mapping: HeaderMappingResult[] = [
    createMapping('Brand Name', 'source_item_name'),
    createMapping('C Val', 'reported_closing_stock_value'),
  ];

  const validated = validateMappedRow(8, rawData, mapping);
  assert.equal(validated.normalizedData.reported_closing_stock_value, '25000.50');
  assert.equal(validated.rawData['C Val'], '₹ 25,000.50');
});

test('unknown mapped field creates warning mapping issue', () => {
  const rawData = { 'Brand Name': 'ABter Trio', 'Custom Field': '123' };
  const mapping: HeaderMappingResult[] = [
    createMapping('Brand Name', 'source_item_name'),
    { sourceHeader: 'Custom Field', normalizedHeader: 'custom field', targetField: null, confidence: 'LOW', status: 'UNMAPPED', candidates: [] },
  ];

  const validated = validateMappedRow(9, rawData, mapping);
  assert.equal(validated.validationStatus, 'REVIEW_REQUIRED');
  assert.equal(validated.issues.some((issue) => issue.code === 'MAPPING_REQUIRED'), true);
});

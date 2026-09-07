import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMappedRow } from '../src/lib/import/validation/index.js';
import { detectDuplicates } from '../src/lib/import/duplicates/index.js';

function makeRow(sourceRowNumber: number, rawData: Record<string, unknown>, mapping: Array<any>) {
  const validated = validateMappedRow(sourceRowNumber, rawData, mapping);
  return validated;
}

function mappingFor(headers: string[]) {
  return headers.map((h) => ({ sourceHeader: h, normalizedHeader: h.toLowerCase(), targetField: h === 'Brand' ? 'source_item_name' : (h as any), confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] }));
}

test('same source row identity remains an exact duplicate', () => {
  const r1 = makeRow(1, { 'Brand Name': 'X', 'Purch Qty': '100' }, [
    { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Purch Qty', normalizedHeader: 'purch qty', targetField: 'reported_purchase_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
  ]);

  const r2 = makeRow(1, { 'Brand Name': 'X', 'Purch Qty': '100.00' }, [
    { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Purch Qty', normalizedHeader: 'purch qty', targetField: 'reported_purchase_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
  ]);

  const results = detectDuplicates([r1, r2]);
  // A repeated source row number is an actual source identity collision.
  assert.ok(results.some((r) => r.status === 'EXACT_DUPLICATE'));
});

test('identical business values on different source rows are independent', () => {
  const r1 = makeRow(1, { 'Brand Name': 'A', 'Purch Qty': '1,000' }, [
    { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Purch Qty', normalizedHeader: 'purch qty', targetField: 'reported_purchase_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
  ]);
  const r2 = makeRow(2, { 'Brand Name': 'A', 'Purch Qty': '1000' }, [
    { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Purch Qty', normalizedHeader: 'purch qty', targetField: 'reported_purchase_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
  ]);

  const res = detectDuplicates([r1, r2]);
  assert.ok(res.every((r) => r.status === 'NEW'));
});

test('same Product on different source rows with different values is allowed', () => {
  const mapping = [
    { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Purch Qty', normalizedHeader: 'purch qty', targetField: 'reported_purchase_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
  ];
  const r1 = makeRow(9, { 'Brand Name': 'BINAPREX ER-250 MG TABLETS', 'Purch Qty': '1' }, mapping);
  const r2 = makeRow(22, { 'Brand Name': 'BINAPREX ER-250 MG TABLETS', 'Purch Qty': '2' }, mapping);
  assert.deepEqual(detectDuplicates([r1, r2]).map((result) => result.status), ['NEW', 'NEW']);
});

test('different quantity -> NOT exact duplicate', () => {
  const r1 = makeRow(1, { 'Brand Name': 'B', 'Purch Qty': '100' }, [
    { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Purch Qty', normalizedHeader: 'purch qty', targetField: 'reported_purchase_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
  ]);
  const r2 = makeRow(2, { 'Brand Name': 'B', 'Purch Qty': '101' }, [
    { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Purch Qty', normalizedHeader: 'purch qty', targetField: 'reported_purchase_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
  ]);

  const res = detectDuplicates([r1, r2]);
  assert.equal(res.every((r) => r.status !== 'EXACT_DUPLICATE'), true);
});

test('different unit -> NOT exact duplicate', () => {
  const r1 = makeRow(1, { 'Brand Name': 'C', 'Purch Qty': '100', 'Unit': 'strips' }, [
    { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Purch Qty', normalizedHeader: 'purch qty', targetField: 'reported_purchase_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Unit', normalizedHeader: 'unit', targetField: 'quantity_unit', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
  ]);
  const r2 = makeRow(2, { 'Brand Name': 'C', 'Purch Qty': '100', 'Unit': 'boxes' }, [
    { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Purch Qty', normalizedHeader: 'purch qty', targetField: 'reported_purchase_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Unit', normalizedHeader: 'unit', targetField: 'quantity_unit', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
  ]);

  const res = detectDuplicates([r1, r2]);
  assert.equal(res.every((r) => r.status !== 'EXACT_DUPLICATE'), true);
});

test('similar business values on separate source rows remain independent', () => {
  const r1 = makeRow(1, { 'Brand Name': 'D', 'Purch Qty': '100', 'Sales Qty': '50' }, [
    { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Purch Qty', normalizedHeader: 'purch qty', targetField: 'reported_purchase_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Sales Qty', normalizedHeader: 'sales qty', targetField: 'reported_sales_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
  ]);
  const r2 = makeRow(2, { 'Brand Name': 'D', 'Purch Qty': '100', 'Sales Qty': '51' }, [
    { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Purch Qty', normalizedHeader: 'purch qty', targetField: 'reported_purchase_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
    { sourceHeader: 'Sales Qty', normalizedHeader: 'sales qty', targetField: 'reported_sales_qty', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] },
  ]);

  const res = detectDuplicates([r1, r2], { possibleThreshold: 50 });
  assert.deepEqual(res.map((result) => result.status), ['NEW', 'NEW']);
});

test('empty import returns empty results', () => {
  const res = detectDuplicates([]);
  assert.deepEqual(res, []);
});

test('single row import returns NEW', () => {
  const r = makeRow(1, { 'Brand Name': 'Solo' }, [ { sourceHeader: 'Brand Name', normalizedHeader: 'brand name', targetField: 'source_item_name', confidence: 'HIGH', status: 'AUTO_MAPPED', candidates: [] } ]);
  const res = detectDuplicates([r]);
  assert.equal(res.length, 1);
  assert.equal(res[0].status, 'NEW');
});


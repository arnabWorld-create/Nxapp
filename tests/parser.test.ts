import assert from 'node:assert/strict';
import test from 'node:test';
import XLSX from 'xlsx';
import { parseCsvFile, parseImportFile, parseWorkbook, getWorkbookSheetInfo, ParserError } from '../src/lib/import/parser/index.js';

test('simple CSV parses headers and rows', async () => {
  const file = new File(['Brand Name,Sales Qty\nABter Trio,100\n'], 'simple.csv', { type: 'text/csv' });
  const parsed = await parseImportFile(file);

  assert.equal(parsed.fileType, 'csv');
  assert.deepEqual(parsed.headers, ['Brand Name', 'Sales Qty']);
  assert.deepEqual(parsed.rows[0].rawData, { 'Brand Name': 'ABter Trio', 'Sales Qty': '100' });
  assert.equal(parsed.rows[0].sourceRowNumber, 2);
});

test('CSV with quoted commas preserves values', async () => {
  const file = new File(['Brand Name,Sales Qty\n"ABter, Trio",100\n'], 'quoted.csv', { type: 'text/csv' });
  const parsed = await parseImportFile(file);

  assert.deepEqual(parsed.headers, ['Brand Name', 'Sales Qty']);
  assert.deepEqual(parsed.rows[0].rawData, { 'Brand Name': 'ABter, Trio', 'Sales Qty': '100' });
});

test('CSV with BOM is parsed successfully', async () => {
  const bom = '\uFEFF';
  const file = new File([bom + 'Brand Name,Sales Qty\nABter Trio,100\n'], 'bom.csv', { type: 'text/csv' });
  const parsed = await parseImportFile(file);

  assert.deepEqual(parsed.headers, ['Brand Name', 'Sales Qty']);
});

test('semicolon CSV parses correctly', async () => {
  const file = new File(['Brand Name;Sales Qty\nABter Trio;100\n'], 'semi.csv', { type: 'text/csv' });
  const parsed = await parseImportFile(file);

  assert.equal(parsed.metadata.fileType, 'csv');
  assert.deepEqual(parsed.rows[0].rawData['Sales Qty'], '100');
});

test('tab-delimited CSV parses correctly', async () => {
  const file = new File(['Brand Name\tSales Qty\nABter Trio\t100\n'], 'tab.csv', { type: 'text/csv' });
  const parsed = await parseImportFile(file);

  assert.equal(parsed.fileType, 'csv');
  assert.equal(parsed.rows[0].rawData['Sales Qty'], '100');
});

test('CSV with empty rows preserves source row numbering', async () => {
  const file = new File(['Brand Name,Sales Qty\nABter Trio,100\n\nAnother,50\n'], 'empty.csv', { type: 'text/csv' });
  const parsed = await parseImportFile(file);

  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows.map((row) => row.sourceRowNumber), [2, 4]);
});

test('Malformed CSV returns parser error', async () => {
  const file = new File(['Brand Name,Sales Qty\n"ABter Trio,100\n'], 'malformed.csv', { type: 'text/csv' });
  await assert.rejects(async () => parseImportFile(file), ParserError);
});

function createXlsxFile(sheets: Array<{ name: string; data: Array<Array<unknown>> }>) {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.data);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  return new File([buffer], 'generated.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

test('XLSX workbook sheet discovery returns metadata', async () => {
  const file = createXlsxFile([
    { name: 'Sheet1', data: [['Brand Name', 'Sales Qty'], ['ABter Trio', 100]] },
  ]);
  const sheets = await getWorkbookSheetInfo(file);

  assert.ok(sheets.length >= 1);
  assert.ok(sheets.some((sheet) => sheet.name === 'Sheet1'));
});

test('XLSX parseWorkbook preserves headers and source rows', async () => {
  const file = createXlsxFile([
    { name: 'Sheet1', data: [['Brand Name', 'Sales Qty'], ['ABter Trio', 100]] },
  ]);
  const parsed = await parseWorkbook(file, 'Sheet1');

  assert.deepEqual(parsed.headers, ['Brand Name', 'Sales Qty']);
  assert.deepEqual(parsed.rows[0].rawData, { 'Brand Name': 'ABter Trio', 'Sales Qty': 100 });
  assert.equal(parsed.rows[0].sourceRowNumber, 2);
});

test('XLSX with multiple sheets returns sheet list', async () => {
  const file = createXlsxFile([
    { name: 'Sheet1', data: [['A', 'B'], [1, 2]] },
    { name: 'Sheet2', data: [['X', 'Y'], [3, 4]] },
  ]);
  const sheets = await getWorkbookSheetInfo(file);

  assert.ok(sheets.length >= 2);
  assert.ok(sheets.map((sheet) => sheet.name).includes('Sheet1'));
  assert.ok(sheets.map((sheet) => sheet.name).includes('Sheet2'));
});

test('Missing sheet returns SHEET_NOT_FOUND error', async () => {
  const file = createXlsxFile([
    { name: 'Sheet1', data: [['Brand Name', 'Sales Qty'], ['ABter Trio', 100]] },
  ]);
  await assert.rejects(async () => parseWorkbook(file, 'DoesNotExist'), ParserError);
});

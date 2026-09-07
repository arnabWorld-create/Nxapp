import type { WorkBook, WorkSheet } from 'xlsx';
import * as XLSX from 'xlsx';
import { ParserError, ParsedFile, ParsedRow } from './types';

async function readWorkbook(file: File): Promise<WorkBook> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  try {
    return XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });
  } catch (err) {
    throw new ParserError('WORKBOOK_READ_ERROR', 'Unable to read Excel workbook', {
      details: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

function normalizeHeaders(rawHeaders: Array<string | number | null | undefined>): string[] {
  return rawHeaders.map((header) => {
    if (header === null || header === undefined) {
      return '';
    }
    return String(header);
  });
}

function getSheetRows(sheet: WorkSheet) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const rows: GridCell[][] = [];

  for (let rowNum = range.s.r; rowNum <= range.e.r; rowNum += 1) {
    const cols: GridCell[] = [];
    for (let colNum = range.s.c; colNum <= range.e.c; colNum += 1) {
      const cellAddress = XLSX.utils.encode_cell({ c: colNum, r: rowNum });
      const cell = sheet[cellAddress];
      cols.push({ value: cell?.v ?? '' });
    }
    rows.push(cols);
  }

  return rows;
}

type GridCell = { value: unknown };

export async function getWorkbookSheetInfo(file: File) {
  const workbook = await readWorkbook(file);
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    return {
      name,
      rowCount: range.e.r - range.s.r + 1,
    };
  });
}

export async function parseWorkbook(file: File, sheetName: string): Promise<ParsedFile> {
  const workbook = await readWorkbook(file);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new ParserError('SHEET_NOT_FOUND', `Sheet not found: ${sheetName}`, {
      details: { sheetName },
    });
  }

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  if (range.e.r < range.s.r) {
    throw new ParserError('EMPTY_FILE', 'Workbook sheet contains no rows');
  }

  const rows: ParsedRow[] = [];
  const headers: string[] = [];
  let emptyRowsSkipped = 0;

  for (let rowNum = range.s.r; rowNum <= range.e.r; rowNum += 1) {
    const rowValues: unknown[] = [];
    for (let colNum = range.s.c; colNum <= range.e.c; colNum += 1) {
      const address = XLSX.utils.encode_cell({ c: colNum, r: rowNum });
      const cell = sheet[address];
      rowValues.push(cell?.v ?? '');
    }

    if (rowNum === range.s.r) {
      for (const value of rowValues) {
        headers.push(value === undefined || value === null ? '' : String(value));
      }
      continue;
    }

    const rawData: Record<string, unknown> = {};
    let rowEmpty = true;
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const header = headers[columnIndex] || `column_${columnIndex + 1}`;
      const cellValue = rowValues[columnIndex] ?? '';
      rawData[header] = cellValue;
      if (cellValue !== '' && cellValue !== null && cellValue !== undefined) {
        rowEmpty = false;
      }
    }

    const sourceRowNumber = rowNum + 1;
    if (rowEmpty) {
      emptyRowsSkipped += 1;
      continue;
    }

    rows.push({ sourceRowNumber, rawData });
  }

  return {
    fileType: file.name.endsWith('.xls') ? 'xls' : 'xlsx',
    headers,
    rows,
    metadata: {
      fileType: file.name.endsWith('.xls') ? 'xls' : 'xlsx',
      sheetName,
      totalSourceRows: range.e.r - range.s.r + 1,
      parsedRows: rows.length,
      emptyRowsSkipped,
      totalColumns: headers.length,
      headerRowNumber: range.s.r + 1,
    },
  };
}

export async function parseWorkbookSheets(file: File) {
  const workbook = await readWorkbook(file);
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    return {
      name,
      rowCount: range.e.r - range.s.r + 1,
    };
  });
}

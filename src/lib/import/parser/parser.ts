import { parseCsvFile } from './csv-parser';
import { parseWorkbook, getWorkbookSheetInfo } from './excel-parser';
import { ParserError, ParsedFile, ParsedRow, ParserErrorCode } from './types';

export type ParseResult = ParsedFile;

export async function parseImportFile(file: File): Promise<ParsedFile> {
  const fileType = determineFileType(file.name);
  if (fileType === 'csv') {
    return parseCsvFile(file);
  }

  if (fileType === 'xls' || fileType === 'xlsx') {
    const sheets = await getWorkbookSheetInfo(file);
    if (sheets.length === 0) {
      throw new ParserError('EMPTY_FILE', 'Workbook contains no sheets');
    }
    return parseWorkbook(file, sheets[0].name);
  }

  throw new ParserError('UNSUPPORTED_FORMAT', 'Unsupported import file format');
}

export async function getImportFileSheets(file: File) {
  const fileType = determineFileType(file.name);
  if (fileType === 'csv') {
    return [{ name: 'CSV', rowCount: 0 }];
  }
  return getWorkbookSheetInfo(file);
}

function determineFileType(fileName: string): 'csv' | 'xls' | 'xlsx' | 'unsupported' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xls')) return 'xls';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return 'unsupported';
}

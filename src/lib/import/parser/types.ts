export type ImportFileType = 'csv' | 'xls' | 'xlsx';

export type ParsedRow = {
  sourceRowNumber: number;
  rawData: Record<string, unknown>;
};

export type ParsedFileMetadata = {
  fileType: ImportFileType;
  sheetName?: string;
  sheets?: Array<{ name: string; rowCount: number }>;
  totalSourceRows: number;
  parsedRows: number;
  emptyRowsSkipped: number;
  totalColumns: number;
  headerRowNumber: number;
};

export type ParsedFile = {
  fileType: ImportFileType;
  headers: string[];
  rows: ParsedRow[];
  metadata: ParsedFileMetadata;
};

export type ParserErrorCode =
  | 'INVALID_FILE'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_CSV'
  | 'WORKBOOK_READ_ERROR'
  | 'SHEET_NOT_FOUND'
  | 'EMPTY_FILE'
  | 'HEADER_NOT_FOUND'
  | 'PARSE_ERROR';

export type ParserErrorDetails = Record<string, unknown>;

export class ParserError extends Error {
  code: ParserErrorCode;
  sourceRowNumber?: number;
  details?: ParserErrorDetails;

  constructor(
    code: ParserErrorCode,
    message: string,
    options?: { sourceRowNumber?: number; details?: ParserErrorDetails }
  ) {
    super(message);
    this.name = 'ParserError';
    this.code = code;
    this.sourceRowNumber = options?.sourceRowNumber;
    this.details = options?.details;
  }
}

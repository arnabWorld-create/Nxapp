import { ParserError, ParsedFile, ParserErrorCode, ParsedRow } from './types';

const DELIMITERS = [',', ';', '\t'];

function detectDelimiter(sample: string): string | null {
  const counts = DELIMITERS.map((delimiter) => ({
    delimiter,
    count: sample.split(delimiter).length - 1,
  }));

  const sorted = counts.sort((a, b) => b.count - a.count);
  if (sorted[0].count === 0) {
    return null;
  }

  if (sorted[0].count === sorted[1]?.count) {
    return null;
  }

  return sorted[0].delimiter;
}

function splitRows(input: string): string[] {
  return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i += 1;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  if (inQuotes) {
    throw new ParserError('INVALID_CSV', 'Quoted field is not terminated', {
      details: { line },
    });
  }

  values.push(current);
  return values;
}

function parseCsvRows(content: string, delimiter: string) {
  const lines = splitRows(content);
  const rows: string[][] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '' && index === lines.length - 1) {
      continue;
    }

    try {
      rows.push(parseCsvLine(line, delimiter));
    } catch (error) {
      if (error instanceof ParserError) {
        throw new ParserError('INVALID_CSV', 'Malformed CSV row', {
          sourceRowNumber: index + 1,
          details: { line, originalError: error.details },
        });
      }
      throw error;
    }
  }

  return rows;
}

function normalizeHeaders(rawHeaders: string[]): string[] {
  return rawHeaders.map((header) => header ?? '');
}

export async function parseCsvFile(file: File): Promise<ParsedFile> {
  const contentBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(contentBuffer);

  if (buffer.byteLength === 0) {
    throw new ParserError('EMPTY_FILE', 'CSV file is empty');
  }

  let content = new TextDecoder('utf-8').decode(buffer);
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const sample = content.slice(0, 4096);
  const delimiter = detectDelimiter(sample);
  if (!delimiter) {
    throw new ParserError('INVALID_CSV', 'Unable to determine CSV delimiter', {
      details: { sample: sample.slice(0, 256) },
    });
  }

  const rawRows = parseCsvRows(content, delimiter);
  if (rawRows.length === 0) {
    throw new ParserError('EMPTY_FILE', 'CSV file contains no rows');
  }

  const headers = normalizeHeaders(rawRows[0].map((value) => value.toString()));
  const rows: ParsedRow[] = [];
  let emptyRowsSkipped = 0;

  for (let rowIndex = 1; rowIndex < rawRows.length; rowIndex += 1) {
    const values = rawRows[rowIndex];
    const row: Record<string, unknown> = {};
    let empty = true;

    for (let colIndex = 0; colIndex < headers.length; colIndex += 1) {
      const header = headers[colIndex] ?? `column_${colIndex + 1}`;
      const rawValue = values[colIndex] ?? '';
      row[header] = rawValue;
      if (rawValue !== '') {
        empty = false;
      }
    }

    const sourceRowNumber = rowIndex + 1;
    if (empty) {
      emptyRowsSkipped += 1;
      continue;
    }

    rows.push({ sourceRowNumber, rawData: row });
  }

  return {
    fileType: 'csv',
    headers,
    rows,
    metadata: {
      fileType: 'csv',
      totalSourceRows: rawRows.length,
      parsedRows: rows.length,
      emptyRowsSkipped,
      totalColumns: headers.length,
      headerRowNumber: 1,
    },
  };
}

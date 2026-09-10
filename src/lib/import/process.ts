import path from 'path';
import prisma from '../prisma';
import { storage } from '../storage';
import { getStorageKey } from './upload';
import { parseCsvFile } from './parser/csv-parser';
import { parseWorkbook, getWorkbookSheetInfo } from './parser/excel-parser';
import { buildHeaderMappingResults, validateTemplate } from './mapping';
import { validateMappedRow } from './validation';
import { detectDuplicates } from './duplicates';
import type { ValidatedRow, ValidationStatus } from './validation';
import type { DuplicateResult, DuplicateStatus } from './duplicates';
import type { ImportMappingTemplate } from './mapping';
import { matchingEngine } from '../matching/engine';

export class ProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcessError';
  }
}

interface ProcessOptions {
  mappingTemplateId?: string;
  customMapping?: Record<string, string>;
  actorId?: string;
  onStage?: (stage: ProcessingStage) => void;
}

type ProcessingStage = 'LOAD_FILE' | 'PARSE_FILE' | 'LOAD_MAPPING' | 'VALIDATE_ROWS' | 'DETECT_DUPLICATES' | 'PERSIST_ROWS' | 'FINALIZE';

interface ProcessingResult {
  importId: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  reviewRequiredRows: number;
  exactDuplicates: number;
  possibleDuplicates: number;
}

function classifyRow(validated: ValidatedRow): { rowType: 'DATA_ROW' | 'SUMMARY_ROW' | 'NON_DATA_ROW'; reason: string | null } {
  const hasNumericValue = Object.entries(validated.normalizedData).some(
    ([field, value]) => field !== 'quantity_unit' && field !== 'source_item_name' && value !== null
  );

  const sourceItemName = validated.normalizedData.source_item_name ?? '';
  const isMetadataLabel = /\b(?:PRIVATE|PVT|LIMITED|LTD|LLP|INC|CORP(?:ORATION)?)\b/i.test(sourceItemName);

  if (sourceItemName && (!isMetadataLabel || hasNumericValue)) {
    return { rowType: 'DATA_ROW', reason: null };
  }

  return hasNumericValue
    ? { rowType: 'SUMMARY_ROW', reason: 'No source item identity; row contains aggregate numeric values.' }
    : { rowType: 'NON_DATA_ROW', reason: 'Item label identifies file metadata rather than a product row.' };
}

export function isCnxStatementFormat(headers: string[]): boolean {
  const normalizedHeaders = new Set(headers.map((header) => header.trim().toLowerCase()));
  const hasSalesColumns = normalizedHeaders.has('s.qty') && normalizedHeaders.has('s.val');
  return normalizedHeaders.has('item') && normalizedHeaders.has('clstk') && hasSalesColumns;
}

export function applyAutomaticQuantityUnit(validated: ValidatedRow, unit: string): ValidatedRow {
  if (validated.normalizedData.quantity_unit || validated.validationStatus === 'INVALID') return validated;

  const issues = validated.issues.filter((issue) => issue.code !== 'MISSING_QUANTITY_UNIT');
  const validationStatus = issues.some((issue) => issue.severity === 'ERROR')
    ? 'INVALID'
    : issues.some((issue) => issue.severity === 'WARNING')
      ? 'REVIEW_REQUIRED'
      : 'VALID';

  return {
    ...validated,
    normalizedData: { ...validated.normalizedData, quantity_unit: unit },
    issues,
    validationStatus,
  };
}

async function getFileBuffer(importRecord: Awaited<ReturnType<typeof prisma.import.findUnique>>) {
  if (!importRecord) {
    throw new ProcessError('Import record not found');
  }

  if (!importRecord.file_sha256) {
    throw new ProcessError('Import record missing SHA256 hash');
  }

  const key = getStorageKey(importRecord.file_sha256, path.extname(importRecord.file_name));

  try {
    return await storage.get(key);
  } catch (error) {
    throw new ProcessError(`Unable to read uploaded file`);
  }
}

async function parseFileBuffer(buffer: Buffer, fileType: string) {
  const fileExt = fileType.toLowerCase().startsWith('.') ? fileType.toLowerCase() : '.' + fileType.toLowerCase();

  if (fileExt === '.csv') {
    // For CSV, we need to convert buffer to File for the parser
    const text = buffer.toString('utf-8');
    const blob = new Blob([text], { type: 'text/csv' });
    const file = new File([blob], 'upload.csv', { type: 'text/csv' });
    return parseCsvFile(file);
  }

  if (fileExt === '.xlsx' || fileExt === '.xls') {
    // For Excel, we need to create a File object from buffer for the parser
    // Convert Buffer to Uint8Array to avoid type issues
    const uint8Array = new Uint8Array(buffer);
    const blob = new Blob([uint8Array], { type: 'application/octet-stream' });
    const file = new File([blob], 'upload' + fileExt, { type: 'application/octet-stream' });
    const sheets = await getWorkbookSheetInfo(file);
    if (sheets.length === 0) {
      throw new ProcessError('Workbook contains no sheets');
    }
    return parseWorkbook(file, sheets[0].name);
  }

  throw new ProcessError(`Unsupported file type: ${fileExt}`);
}

async function getMappingTemplate(
  fileType: string,
  options: ProcessOptions
): Promise<ImportMappingTemplate | undefined> {
  if (options.mappingTemplateId) {
    const template = await prisma.importMapping.findUnique({
      where: { id: options.mappingTemplateId },
    });

    if (!template) {
      throw new ProcessError('Mapping template not found');
    }

    const mappingJson = template.mapping_json as ImportMappingTemplate;
    if (!validateTemplate(mappingJson)) {
      throw new ProcessError('Invalid mapping template');
    }

    return mappingJson;
  }

  // No template specified - will use automatic mapping
  return undefined;
}

async function processImportInternal(importId: string, options: ProcessOptions = {}): Promise<ProcessingResult> {
  let stage: ProcessingStage = 'LOAD_FILE';
  options.onStage?.(stage);
  // Fetch Import record
  const importRecord = await prisma.import.findUnique({
    where: { id: importId },
  });

  if (!importRecord) {
    throw new ProcessError('Import not found');
  }

  await prisma.import.update({ where: { id: importId }, data: { status: 'PROCESSING', failure_stage: null, failure_message: null, failed_at: null } });
  await prisma.auditLog.create({ data: { user_id: options.actorId ?? importRecord.uploaded_by, action: 'IMPORT_PROCESSING_STARTED', entity_type: 'Import', entity_id: importId, new_value: { status: 'PROCESSING' } } });

  // Get file buffer
  const fileBuffer = await getFileBuffer(importRecord);

  // Parse file. `file_type` is the upload MIME type (e.g. "text/csv"), so the
  // parser must be chosen from the original file extension instead.
  stage = 'PARSE_FILE';
  options.onStage?.(stage);
  const parsedFile = await parseFileBuffer(fileBuffer, path.extname(importRecord.file_name));

  // Get mapping template if available
  stage = 'LOAD_MAPPING';
  options.onStage?.(stage);
  const mappingTemplate = await getMappingTemplate(importRecord.file_type, options);

  // Map headers to canonical fields
  const mappingResults = buildHeaderMappingResults(parsedFile.headers, mappingTemplate);
  const automaticQuantityUnit = isCnxStatementFormat(parsedFile.headers) ? 'STRIP' : null;

  // Validate all rows
  stage = 'VALIDATE_ROWS';
  options.onStage?.(stage);
  const validatedRows: ValidatedRow[] = [];
  for (const row of parsedFile.rows) {
    const validated = validateMappedRow(row.sourceRowNumber, row.rawData, mappingResults);
    validatedRows.push(automaticQuantityUnit ? applyAutomaticQuantityUnit(validated, automaticQuantityUnit) : validated);
  }

  if (automaticQuantityUnit) {
    await prisma.import.update({
      where: { id: importId },
      data: {
        default_quantity_unit: automaticQuantityUnit,
        default_quantity_unit_confirmed: true,
        default_quantity_unit_confirmed_by: null,
        default_quantity_unit_confirmed_at: new Date(),
      },
    });
  }

  // Detect duplicates
  stage = 'DETECT_DUPLICATES';
  options.onStage?.(stage);
  const duplicateResults = detectDuplicates(validatedRows);

  // Create/update ImportRow records
  const importRows: Array<{
    id?: string;
    sourceRowNumber: number;
    rawData: ValidatedRow['rawData'];
    normalizedData: ValidatedRow['normalizedData'];
    validationStatus: ValidationStatus;
    duplicateStatus: DuplicateStatus;
    validationIssues: ValidatedRow['issues'];
    duplicateResult?: DuplicateResult;
    rowType: 'DATA_ROW' | 'SUMMARY_ROW' | 'NON_DATA_ROW';
    nonDataReason: string | null;
  }> = [];

  for (let i = 0; i < validatedRows.length; i++) {
    const validated = validatedRows[i];
    const duplicateResult = duplicateResults[i];
    const classification = classifyRow(validated);
    const issues = classification.rowType === 'DATA_ROW'
      ? validated.issues
      : validated.issues.filter((issue) => issue.code !== 'SOURCE_ITEM_NAME_REQUIRED' && issue.code !== 'MISSING_QUANTITY_UNIT');
    const validationStatus = classification.rowType === 'DATA_ROW'
      ? validated.validationStatus
      : issues.some((issue) => issue.severity === 'ERROR')
        ? 'INVALID'
        : issues.some((issue) => issue.severity === 'WARNING')
          ? 'REVIEW_REQUIRED'
          : 'VALID';

    importRows.push({
      sourceRowNumber: validated.sourceRowNumber,
      rawData: validated.rawData,
      normalizedData: validated.normalizedData,
      validationStatus,
      duplicateStatus: duplicateResult?.status ?? 'NEW',
      validationIssues: issues,
      duplicateResult,
      rowType: classification.rowType,
      nonDataReason: classification.reason,
    });
  }

  stage = 'PERSIST_ROWS';
  options.onStage?.(stage);
  // Delete existing ImportRow records for this import
  await prisma.importRow.deleteMany({
    where: { import_id: importId },
  });

  // Batch create ImportRow records
  const createdRows = await Promise.all(
    importRows.map((row) =>
      prisma.importRow.create({
        data: {
          import_id: importId,
          source_row_number: row.sourceRowNumber,
          row_type: row.rowType,
          non_data_reason: row.nonDataReason,
          raw_data_json: row.rawData as any,
          parsed_data_json: {
            normalizedData: row.normalizedData,
            validationIssues: row.validationIssues,
            duplicateResult: row.duplicateResult,
          } as any,
          validation_status: row.validationStatus,
          duplicate_status: row.duplicateStatus,
        },
      }).then((created) => ({ created, row }))
    )
  );

  await Promise.all(createdRows.map(async ({ created, row }) => {
    if (row.rowType !== 'DATA_ROW' || row.validationStatus === 'INVALID' || !row.normalizedData.source_item_name) {
      return;
    }

    const match = await matchingEngine.suggestMatches({
      importRowId: created.id,
      sourceName: row.normalizedData.source_item_name,
      normalizedSourceName: row.normalizedData.source_item_name,
    });
    const candidate = match.candidates.length === 1 ? match.candidates[0] : null;
    if (!candidate || (candidate.reason !== 'normalized_exact_match' && candidate.reason !== 'safe_normalized_master_match' && candidate.reason !== 'alias_match')) {
      return;
    }

    await prisma.importRow.update({
      where: { id: created.id },
      data: {
        confirmed_brand_id: candidate.brandId ?? null,
        confirmed_product_id: candidate.entityType === 'PRODUCT' ? candidate.entityId : candidate.parentProductId ?? null,
        confirmed_variant_id: candidate.entityType === 'VARIANT' ? candidate.entityId : null,
        confirmed_by_user_id: null,
        confirmed_at: new Date(),
        match_reason: `AUTO_MATCHED:${candidate.reason}`,
      },
    });
  }));

  // Calculate summary
  const stats = {
    totalRows: importRows.length,
    validRows: importRows.filter((r) => r.validationStatus === 'VALID').length,
    invalidRows: importRows.filter((r) => r.validationStatus === 'INVALID').length,
    reviewRequiredRows: importRows.filter((r) => r.validationStatus === 'REVIEW_REQUIRED').length,
    exactDuplicates: importRows.filter((r) => r.duplicateStatus === 'EXACT_DUPLICATE').length,
    possibleDuplicates: importRows.filter((r) => r.duplicateStatus === 'POSSIBLE_DUPLICATE').length,
  };

  stage = 'FINALIZE';
  options.onStage?.(stage);
  // Processing completed successfully; review is now available.
  await prisma.import.update({
    where: { id: importId },
    data: {
      status: 'READY_FOR_REVIEW',
    },
  });
  await prisma.auditLog.create({ data: { user_id: options.actorId ?? importRecord.uploaded_by, action: 'IMPORT_PROCESSING_COMPLETED', entity_type: 'Import', entity_id: importId, new_value: { status: 'READY_FOR_REVIEW', totalRows: stats.totalRows } } });

  return {
    importId,
    ...stats,
  };
}

export async function processImport(importId: string, options: ProcessOptions = {}): Promise<ProcessingResult> {
  let failureStage: ProcessingStage = 'LOAD_FILE';
  try {
    return await processImportInternal(importId, { ...options, onStage: (stage) => { failureStage = stage; options.onStage?.(stage); } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Import processing failed';
    await prisma.import.updateMany({
      where: { id: importId, status: { in: ['UPLOADED', 'PROCESSING'] } },
      data: { status: 'FAILED', failure_stage: failureStage, failure_message: message, failed_at: new Date() },
    });
    await prisma.auditLog.create({ data: { user_id: options.actorId, action: 'IMPORT_PROCESSING_FAILED', entity_type: 'Import', entity_id: importId, new_value: { status: 'FAILED', failureStage, failureMessage: message } } }).catch(() => undefined);
    throw error;
  }
}

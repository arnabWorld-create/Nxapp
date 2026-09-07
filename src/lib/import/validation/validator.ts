import type { HeaderMappingResult, CanonicalField } from '../mapping';
import { isValidCanonicalField } from '../mapping';
import { normalizeText, isBlankValue } from './normalize';
import { normalizeSourceItemName } from '../../matching/utils';
import { normalizeNumericValue } from './numeric';
import { normalizeQuantityUnit } from './unit';
import type { ValidatedRow, ValidationIssue } from './types';

const QUANTITY_FIELDS: CanonicalField[] = [
  'reported_purchase_qty',
  'reported_sales_qty',
  'reported_sales_return_qty',
  'reported_purchase_return_qty',
  'reported_closing_stock_qty',
];

const VALUE_FIELDS: CanonicalField[] = [
  'reported_purchase_value',
  'reported_sales_value',
  'reported_sales_return_value',
  'reported_purchase_return_value',
  'reported_closing_stock_value',
];

function createIssue(
  code: ValidatedRow['issues'][number]['code'],
  field: ValidatedRow['issues'][number]['field'],
  sourceHeader: string,
  sourceValue: unknown,
  severity: 'ERROR' | 'WARNING',
  message: string
): ValidationIssue {
  return {
    code,
    field,
    sourceHeader,
    sourceValue,
    severity,
    message,
  };
}

function createEmptyNormalizedData(): ValidatedRow['normalizedData'] {
  return {
    source_item_name: null,
    reported_purchase_qty: null,
    reported_purchase_value: null,
    reported_sales_qty: null,
    reported_sales_value: null,
    reported_sales_return_qty: null,
    reported_sales_return_value: null,
    reported_purchase_return_qty: null,
    reported_purchase_return_value: null,
    reported_closing_stock_qty: null,
    reported_closing_stock_value: null,
    quantity_unit: null,
  };
}

export function validateMappedRow(
  sourceRowNumber: number,
  rawData: Record<string, unknown>,
  mappingResults: HeaderMappingResult[]
): ValidatedRow {
  const normalizedData = createEmptyNormalizedData();
  const issues: ValidationIssue[] = [];
  let quantityFieldPresent = false;

  for (const mapping of mappingResults) {
    const { sourceHeader, targetField, status } = mapping;
    const sourceValue = rawData[sourceHeader];
    const hasValue = !isBlankValue(sourceValue);

    if (status === 'IGNORED') {
      continue;
    }

    if (!targetField) {
      if (hasValue) {
        issues.push(
          createIssue(
            'MAPPING_REQUIRED',
            'unknown_field',
            sourceHeader,
            sourceValue,
            'WARNING',
            `${sourceHeader} is not mapped to a target field and requires review.`
          )
        );
      }
      continue;
    }

    if (!isValidCanonicalField(targetField)) {
      if (hasValue) {
        issues.push(
          createIssue(
            'UNKNOWN_FIELD',
            'unknown_field',
            sourceHeader,
            sourceValue,
            'ERROR',
            `${sourceHeader} maps to an unknown target field.`
          )
        );
      }
      continue;
    }

    const normalizedText = targetField === 'source_item_name'
      ? normalizeSourceItemName(String(sourceValue))
      : normalizeText(sourceValue);
    if (targetField === 'source_item_name') {
      const normalizedSourceItemName = normalizedText === null || normalizedText.trim() === '' ? null : normalizedText;
      normalizedData.source_item_name = normalizedSourceItemName;
      if (normalizedSourceItemName === null) {
        issues.push(
          createIssue(
            'SOURCE_ITEM_NAME_REQUIRED',
            'source_item_name',
            sourceHeader,
            sourceValue,
            'ERROR',
            'Source item name is required.'
          )
        );
      }
      continue;
    }

    if (targetField === 'quantity_unit') {
      normalizedData.quantity_unit = normalizeQuantityUnit(sourceValue);
      continue;
    }

    if (QUANTITY_FIELDS.includes(targetField)) {
      if (hasValue) {
        quantityFieldPresent = true;
        try {
          const numeric = normalizeNumericValue(sourceValue);
          if (numeric === null) {
            normalizedData[targetField] = null;
          } else {
            normalizedData[targetField] = numeric.normalized;
            if (numeric.isNegative) {
              issues.push(
                createIssue(
                  'NEGATIVE_QUANTITY',
                  targetField,
                  sourceHeader,
                  sourceValue,
                  'WARNING',
                  `${sourceHeader} contains a negative quantity.`
                )
              );
            }
          }
        } catch {
          normalizedData[targetField] = null;
          issues.push(
            createIssue(
              'INVALID_QUANTITY',
              targetField,
              sourceHeader,
              sourceValue,
              'ERROR',
              `${sourceHeader} is not a valid quantity.`
            )
          );
        }
      }
      continue;
    }

    if (VALUE_FIELDS.includes(targetField)) {
      if (hasValue) {
        try {
          const numeric = normalizeNumericValue(sourceValue);
          if (numeric === null) {
            normalizedData[targetField] = null;
          } else {
            normalizedData[targetField] = numeric.normalized;
            if (numeric.isNegative) {
              issues.push(
                createIssue(
                  'NEGATIVE_VALUE',
                  targetField,
                  sourceHeader,
                  sourceValue,
                  'WARNING',
                  `${sourceHeader} contains a negative value.`
                )
              );
            }
          }
        } catch {
          normalizedData[targetField] = null;
          issues.push(
            createIssue(
              'INVALID_VALUE',
              targetField,
              sourceHeader,
              sourceValue,
              'ERROR',
              `${sourceHeader} is not a valid monetary value.`
            )
          );
        }
      }
      continue;
    }

    if (targetField in normalizedData) {
      normalizedData[targetField] = normalizedText;
    }
  }

  if (quantityFieldPresent && normalizedData.quantity_unit === null) {
    issues.push(
      createIssue(
        'MISSING_QUANTITY_UNIT',
        'quantity_unit',
        'quantity_unit',
        rawData['quantity_unit'] ?? null,
        'WARNING',
        'Quantity values are present but no unit was provided.'
      )
    );
  }

  const validationStatus = issues.some((issue) => issue.severity === 'ERROR')
    ? 'INVALID'
    : issues.some((issue) => issue.severity === 'WARNING')
    ? 'REVIEW_REQUIRED'
    : 'VALID';

  return {
    sourceRowNumber,
    rawData,
    normalizedData,
    validationStatus,
    issues,
  };
}

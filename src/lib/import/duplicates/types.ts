import type { ValidatedRow } from '../validation';

export type DuplicateStatus = 'NEW' | 'EXACT_DUPLICATE' | 'POSSIBLE_DUPLICATE';

export type DuplicateResult = {
  status: DuplicateStatus;
  score?: number; // 0-100
  fingerprint?: string;
  matchedFields: Array<keyof ValidatedRow['normalizedData'] | 'source_item_name'>;
  differences: Array<keyof ValidatedRow['normalizedData'] | 'source_item_name'>;
  duplicateOfRowNumber?: number; // sourceRowNumber of the canonical row in the group
};

export type DuplicateDetectOptions = {
  possibleThreshold?: number; // 0-100
};

export { MatchingEngine, matchingEngine } from './engine';
export { normalizeText, calculateSimilarityScore, calculateTokenOverlap, tokenize, scoreToConfidence } from './utils';
export type {
  EntityType,
  ConfidenceLevel,
  MatchStatus,
  MatchingReason,
  MatchCandidate,
  MatchResult,
  MatchingConfig,
  BrandMaster,
  ProductMaster,
  VariantMaster,
  ConfirmedAlias,
  SuggestMatchRequest,
  ConfirmMatchRequest,
  CreateMasterRequest,
} from './types';

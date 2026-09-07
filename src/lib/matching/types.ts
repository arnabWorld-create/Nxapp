/**
 * Core types for Brand/Product/Variant matching engine
 * 
 * CORE BUSINESS RULE:
 * Never automatically merge similar-looking source names.
 * Fuzzy matching = suggestion only. User confirmation = required.
 */

export type EntityType = 'BRAND' | 'PRODUCT' | 'VARIANT';

export type ConfidenceLevel = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_MATCH';

export type MatchStatus = 'UNMATCHED' | 'SUGGESTED' | 'CONFIRMED' | 'REJECTED' | 'AMBIGUOUS' | 'IGNORED';

export type MatchingReason = 
  | 'exact_name_match'
  | 'alias_match'
  | 'normalized_exact_match'
  | 'safe_normalized_master_match'
  | 'fuzzy_similarity'
  | 'high_token_overlap'
  | 'previously_confirmed';

/**
 * Represents a single candidate match
 */
export interface MatchCandidate {
  entityType: EntityType;
  entityId: string;
  entityName: string;
  brandId?: string; // For legacy products/variants: parent brand
  brandName?: string;
  divisionId?: string;
  divisionName?: string;
  parentProductId?: string; // For variants: parent product
  parentProductName?: string;
  
  score: number; // 0-100
  confidence: ConfidenceLevel;
  reason: MatchingReason;
  
  matchedTokens?: string[];
  explanation?: string;
}

/**
 * Result of matching operation on a source item
 */
export interface MatchResult {
  importRowId: string;
  sourceName: string;
  normalizedSourceName?: string;
  
  status: MatchStatus;
  
  // Ranked candidates (sorted by score descending)
  candidates: MatchCandidate[];
  
  // User's selection (if confirmed)
  selectedCandidateId?: string;
  
  // Whether user confirmation is required
  requiresConfirmation: boolean;
  
  // Metadata
  matchedAt?: Date;
  matchedByUserId?: string;
  matchReason?: string;
  previousSelection?: {
    candidateId: string;
    timestamp: Date;
  };
}

/**
 * Configuration for matching thresholds
 */
export interface MatchingConfig {
  // Fuzzy similarity thresholds
  exactMatchThreshold: number; // 100
  highConfidenceThreshold: number; // 90
  mediumConfidenceThreshold: number; // 75
  lowConfidenceThreshold: number; // 60
  
  // Candidate blocking: how many candidates to return max
  maxCandidatesPerLevel: number; // e.g., 5
  
  // Whether to auto-suggest previously confirmed mappings
  autoSuggestPreviouslyConfirmed: boolean; // true but requires review
}

/**
 * Brand master record (from database)
 */
export interface BrandMaster {
  id: string;
  name: string;
  normalized_name: string;
  code?: string;
  status: 'ACTIVE' | 'INACTIVE';
}

/**
 * Product master record (from database)
 */
export interface ProductMaster {
  id: string;
  brand_id?: string;
  division_id?: string;
  name: string;
  normalized_name: string;
  code?: string;
  status: 'ACTIVE' | 'INACTIVE';
}

/**
 * Variant master record (from database)
 */
export interface VariantMaster {
  id: string;
  product_id: string;
  variant_name: string;
  normalized_variant_name?: string;
  pack_size?: string;
  strength?: string;
  status: 'ACTIVE' | 'INACTIVE';
}

/**
 * Confirmed alias (explicit mapping)
 */
export interface ConfirmedAlias {
  id: string;
  source_name: string;
  normalized_source_name: string;
  entity_type: EntityType;
  entity_id: string;
  created_at: Date;
}

/**
 * Request to suggest matches for a source item
 */
export interface SuggestMatchRequest {
  importRowId: string;
  sourceName: string;
  normalizedSourceName?: string;
  fileType?: string;
}

/**
 * Request to confirm a match
 */
export interface ConfirmMatchRequest {
  importRowId: string;
  selectedCandidateId: string;
  reason?: string;
  userId: string;
}

/**
 * Request to create a new master record
 */
export interface CreateMasterRequest {
  entityType: EntityType;
  name: string;
  brandId?: string; // Required for PRODUCT and VARIANT
  productId?: string; // Required for VARIANT
  code?: string;
  packSize?: string; // For VARIANT
  strength?: string; // For VARIANT
  userId: string;
}

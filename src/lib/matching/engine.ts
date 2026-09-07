/**
 * Brand/Product/Variant Matching Engine
 * 
 * MATCHING LEVELS:
 * 1. Exact Master Match - normalized text matches exactly
 * 2. Alias Match - explicit confirmed alias from configuration
 * 3. Fuzzy Suggestion - similarity-based candidates with ranking
 */

import prisma from '../prisma';
import {
  MatchCandidate,
  MatchResult,
  MatchingConfig,
  EntityType,
  ConfidenceLevel,
  MatchingReason,
  BrandMaster,
  ProductMaster,
  VariantMaster,
  ConfirmedAlias,
  SuggestMatchRequest,
} from './types';
import {
  normalizeText,
  normalizeSourceItemName,
  normalizeSafeMatchName,
  normalizeCompactSafeMatchName,
  calculateSimilarityScore,
  calculateTokenOverlap,
  findCommonTokens,
  extractCandidatesByPrefix,
  extractCandidatesByTokenOverlap,
  scoreToConfidence,
} from './utils';

// Default configuration
const DEFAULT_CONFIG: MatchingConfig = {
  exactMatchThreshold: 100,
  highConfidenceThreshold: 90,
  mediumConfidenceThreshold: 75,
  lowConfidenceThreshold: 60,
  maxCandidatesPerLevel: 5,
  autoSuggestPreviouslyConfirmed: true,
};

/**
 * Matching Engine
 */
export class MatchingEngine {
  private config: MatchingConfig;

  constructor(config: Partial<MatchingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * MAIN ENTRY POINT: Suggest matches for a source item
   */
  async suggestMatches(request: SuggestMatchRequest): Promise<MatchResult> {
    const normalizedSource = normalizeSourceItemName(request.normalizedSourceName ?? request.sourceName);
    const sourceRow = await prisma.importRow.findUnique({
      where: { id: request.importRowId },
      select: { match_reason: true },
    });
    const wasRejected = sourceRow?.match_reason?.toUpperCase().includes('REJECTED') ?? false;

    // Step 1: Try exact match
    let candidates: MatchCandidate[] = [];
    let bestMatch = await this.tryExactMatch(request.sourceName, normalizedSource);

    if (bestMatch) {
      return {
        importRowId: request.importRowId,
        sourceName: request.sourceName,
        normalizedSourceName: normalizedSource,
        status: 'SUGGESTED',
        candidates: [bestMatch],
        requiresConfirmation: false, // Exact match is high confidence
      };
    }

    const safeMasterMatches = await this.trySafeNormalizedProductMatches(request.sourceName);
    if (safeMasterMatches.length === 1) {
      return {
        importRowId: request.importRowId,
        sourceName: request.sourceName,
        normalizedSourceName: normalizedSource,
        status: 'SUGGESTED',
        candidates: [safeMasterMatches[0]],
        requiresConfirmation: false,
      };
    }
    if (safeMasterMatches.length > 1) {
      return {
        importRowId: request.importRowId,
        sourceName: request.sourceName,
        normalizedSourceName: normalizedSource,
        status: 'AMBIGUOUS',
        candidates: safeMasterMatches,
        requiresConfirmation: true,
      };
    }

    // Step 2: Try alias match
    const aliasMatches = wasRejected ? [] : await this.tryAliasMatches(normalizedSource);
    if (aliasMatches.length === 1) {
      return {
        importRowId: request.importRowId,
        sourceName: request.sourceName,
        normalizedSourceName: normalizedSource,
        status: 'SUGGESTED',
        candidates: [aliasMatches[0]],
        requiresConfirmation: false,
      };
    }
    if (aliasMatches.length > 1) {
      return {
        importRowId: request.importRowId,
        sourceName: request.sourceName,
        normalizedSourceName: normalizedSource,
        status: 'AMBIGUOUS',
        candidates: aliasMatches,
        requiresConfirmation: true,
      };
    }

    // Step 3: Try previously confirmed mapping
    if (this.config.autoSuggestPreviouslyConfirmed) {
      const previousMatch = wasRejected ? null : await this.tryPreviouslyConfirmedMapping(request.sourceName, normalizedSource);
      if (previousMatch) {
        return {
          importRowId: request.importRowId,
          sourceName: request.sourceName,
          normalizedSourceName: normalizedSource,
          status: 'SUGGESTED',
          candidates: [previousMatch],
          requiresConfirmation: true, // Always requires confirmation
          previousSelection: {
            candidateId: previousMatch.entityId,
            timestamp: new Date(),
          },
        };
      }
    }

    // Step 4: Fuzzy matching - get candidates
    candidates = await this.suggestFuzzyCandidates(request.sourceName, normalizedSource);

    if (candidates.length === 0) {
      return {
        importRowId: request.importRowId,
        sourceName: request.sourceName,
        normalizedSourceName: normalizedSource,
        status: 'UNMATCHED',
        candidates: [],
        requiresConfirmation: false,
      };
    }

    return {
      importRowId: request.importRowId,
      sourceName: request.sourceName,
      normalizedSourceName: normalizedSource,
      status: 'SUGGESTED',
      candidates,
      requiresConfirmation: true, // All fuzzy matches require confirmation
    };
  }

  /**
   * LEVEL 1: Exact Master Match
   * Try to find exact normalized match in masters
   */
  private async tryExactMatch(source: string, normalized: string): Promise<MatchCandidate | null> {
    // Try exact Brand match
    const brand = await prisma.brand.findUnique({
      where: { normalized_name: normalized },
      select: { id: true, name: true, normalized_name: true },
    });

    if (brand && brand.normalized_name === normalized) {
      return {
        entityType: 'BRAND',
        entityId: brand.id,
        entityName: brand.name,
        score: 100,
        confidence: 'EXACT',
        reason: 'normalized_exact_match',
        explanation: `Exact match with brand "${brand.name}"`,
      };
    }

    // Try exact Product match (search by normalized name)
    const product = await prisma.product.findFirst({
      where: { normalized_name: normalized, status: 'ACTIVE' },
      select: { id: true, name: true, normalized_name: true, brand: { select: { id: true, name: true } }, division: { select: { id: true, name: true } } },
      take: 1,
    });

    if (product && product.normalized_name === normalized) {
      return {
        entityType: 'PRODUCT',
        entityId: product.id,
        entityName: product.name,
        brandId: product.brand?.id,
        brandName: product.brand?.name,
        divisionId: product.division?.id,
        divisionName: product.division?.name,
        score: 100,
        confidence: 'EXACT',
        reason: 'normalized_exact_match',
        explanation: product.brand
          ? `Exact match with product "${product.name}" under brand "${product.brand.name}"`
          : `Exact match with master medicine item "${product.name}"`,
      };
    }

    // Try exact Variant match
    const variant = await prisma.productVariant.findFirst({
      where: { normalized_variant_name: normalized, status: 'ACTIVE' },
      select: {
        id: true,
        variant_name: true,
        normalized_variant_name: true,
        product: { select: { id: true, name: true, brand: { select: { id: true, name: true } } } },
      },
      take: 1,
    });

    if (variant && variant.normalized_variant_name === normalized) {
      return {
        entityType: 'VARIANT',
        entityId: variant.id,
        entityName: variant.variant_name,
        parentProductId: variant.product.id,
        parentProductName: variant.product.name,
        brandId: variant.product.brand?.id,
        brandName: variant.product.brand?.name,
        score: 100,
        confidence: 'EXACT',
        reason: 'normalized_exact_match',
        explanation: `Exact match with variant "${variant.variant_name}"`,
      };
    }

    return null;
  }

  /**
   * LEVEL 2: Alias Match
   * Check if source matches any confirmed alias
   */
  private async tryAliasMatches(normalized: string): Promise<MatchCandidate[]> {
    const mappings = await prisma.learnedMapping.findMany({
      where: { normalized_source_name: normalized },
      include: {
        brand: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, division: { select: { id: true, name: true } } } },
        variant: {
          select: {
            id: true,
            variant_name: true,
            product: {
              select: {
                id: true,
                name: true,
                brand: { select: { id: true, name: true } },
                division: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    return mappings.flatMap((mapping): MatchCandidate[] => {
      if (mapping.entity_type === 'PRODUCT' && mapping.product) {
        return [{
          entityType: 'PRODUCT' as const,
          entityId: mapping.product.id,
          entityName: mapping.product.name,
          brandId: mapping.brand?.id,
          brandName: mapping.brand?.name,
          divisionId: mapping.product.division?.id ?? mapping.division_id ?? undefined,
          divisionName: mapping.product.division?.name,
          score: 100,
          confidence: 'EXACT' as const,
          reason: 'alias_match' as const,
          explanation: 'Previously confirmed mapping',
        }];
      }
      if (mapping.entity_type === 'VARIANT' && mapping.variant) {
        return [{
          entityType: 'VARIANT' as const,
          entityId: mapping.variant.id,
          entityName: mapping.variant.variant_name,
          parentProductId: mapping.variant.product.id,
          parentProductName: mapping.variant.product.name,
          brandId: mapping.variant.product.brand?.id,
          brandName: mapping.variant.product.brand?.name,
          divisionId: mapping.variant.product.division?.id ?? mapping.division_id ?? undefined,
          divisionName: mapping.variant.product.division?.name,
          score: 100,
          confidence: 'EXACT' as const,
          reason: 'alias_match' as const,
          explanation: 'Previously confirmed mapping',
        }];
      }
      if (mapping.entity_type === 'BRAND' && mapping.brand) {
        return [{
          entityType: 'BRAND' as const,
          entityId: mapping.brand.id,
          entityName: mapping.brand.name,
          score: 100,
          confidence: 'EXACT' as const,
          reason: 'alias_match' as const,
          explanation: 'Previously confirmed mapping',
        }];
      }
      return [];
    });
  }

  private async trySafeNormalizedProductMatches(source: string): Promise<MatchCandidate[]> {
    const normalizedSource = normalizeSafeMatchName(source);
    const compactSource = normalizeCompactSafeMatchName(source);
    if (!normalizedSource) return [];

    const products = await prisma.product.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        division: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
      },
    });

    return products
      .filter((product) => {
        const normalizedProduct = normalizeSafeMatchName(product.name);
        return normalizedProduct === normalizedSource
          || normalizeCompactSafeMatchName(product.name) === compactSource;
      })
      .map((product) => ({
        entityType: 'PRODUCT' as const,
        entityId: product.id,
        entityName: product.name,
        brandId: product.brand?.id,
        brandName: product.brand?.name,
        divisionId: product.division?.id,
        divisionName: product.division?.name,
        score: 100,
        confidence: 'EXACT' as const,
        reason: 'safe_normalized_master_match' as const,
        explanation: `Safe normalized match with master medicine item "${product.name}"`,
      }));
  }

  /**
   * Check for previously confirmed mappings
   */
  private async tryPreviouslyConfirmedMapping(
    source: string,
    normalized: string
  ): Promise<MatchCandidate | null> {
    // Find rows whose canonical normalized source item name matches the current
    // source and which have been confirmed. The canonical normalized source item
    // name lives in parsed_data_json.normalizedData.source_item_name (see
    // processImport() and validateMappedRow()), NOT in raw_data_json which uses
    // the original CSV headers.
    const previousRow = await prisma.importRow.findFirst({
      where: {
        parsed_data_json: {
          path: ['normalizedData', 'source_item_name'],
          equals: normalized,
        },
        OR: [
          { confirmed_brand_id: { not: null } },
          { confirmed_product_id: { not: null } },
          { confirmed_variant_id: { not: null } },
        ],
      },
      select: {
        confirmed_brand_id: true,
        confirmed_product_id: true,
        confirmed_variant_id: true,
      },
      orderBy: { confirmed_at: 'desc' },
      take: 1,
    });

    if (!previousRow) return null;

    // Reconstruct the candidate from previous confirmation
    if (previousRow.confirmed_variant_id && previousRow.confirmed_product_id) {
      const variant = await prisma.productVariant.findUnique({
        where: { id: previousRow.confirmed_variant_id },
        select: {
          id: true,
          variant_name: true,
          product: { select: { id: true, name: true, brand: { select: { id: true, name: true } } } },
        },
      });

      if (variant) {
        return {
          entityType: 'VARIANT',
          entityId: variant.id,
          entityName: variant.variant_name,
          parentProductId: variant.product.id,
          parentProductName: variant.product.name,
          brandId: variant.product.brand?.id,
          brandName: variant.product.brand?.name,
          score: 95,
          confidence: 'HIGH',
          reason: 'previously_confirmed',
          explanation: 'Previously confirmed mapping for this source name',
        };
      }
    }

    if (previousRow.confirmed_product_id && previousRow.confirmed_brand_id) {
      const product = await prisma.product.findUnique({
        where: { id: previousRow.confirmed_product_id },
        select: { id: true, name: true, brand: { select: { id: true, name: true } }, division: { select: { id: true, name: true } } },
      });

      if (product) {
        return {
          entityType: 'PRODUCT',
          entityId: product.id,
          entityName: product.name,
          brandId: product.brand?.id,
          brandName: product.brand?.name,
          divisionId: product.division?.id,
          divisionName: product.division?.name,
          score: 95,
          confidence: 'HIGH',
          reason: 'previously_confirmed',
          explanation: 'Previously confirmed mapping for this source name',
        };
      }
    }

    if (previousRow.confirmed_brand_id) {
      const brand = await prisma.brand.findUnique({
        where: { id: previousRow.confirmed_brand_id },
        select: { id: true, name: true },
      });

      if (brand) {
        return {
          entityType: 'BRAND',
          entityId: brand.id,
          entityName: brand.name,
          score: 95,
          confidence: 'HIGH',
          reason: 'previously_confirmed',
          explanation: 'Previously confirmed mapping for this source name',
        };
      }
    }

    return null;
  }

  /**
   * LEVEL 3: Fuzzy Suggestion
   * Find candidates through similarity scoring with candidate blocking
   */
  private async suggestFuzzyCandidates(source: string, normalized: string): Promise<MatchCandidate[]> {
    const candidates: MatchCandidate[] = [];

    // Get all active masters
    const brands = await prisma.brand.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, normalized_name: true },
    });

    const products = await prisma.product.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        normalized_name: true,
        brand: { select: { id: true, name: true } },
        division: { select: { id: true, name: true } },
      },
    });

    const variants = await prisma.productVariant.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        variant_name: true,
        normalized_variant_name: true,
        product: { select: { id: true, name: true, brand: { select: { id: true, name: true } } } },
      },
    });

    // Apply candidate blocking for brands
    const brandCandidates = this.extractBrandCandidates(source, brands);
    const productCandidates = this.extractProductCandidates(source, products);
    const variantCandidates = this.extractVariantCandidates(source, variants);

    // Score and rank brands
    for (const brand of brandCandidates) {
      const score = calculateSimilarityScore(source, brand.name);
      if (score >= this.config.lowConfidenceThreshold) {
        const commonTokens = findCommonTokens(source, brand.name);
        candidates.push({
          entityType: 'BRAND',
          entityId: brand.id,
          entityName: brand.name,
          score,
          confidence: scoreToConfidence(score),
          reason: 'fuzzy_similarity',
          matchedTokens: commonTokens,
          explanation: `${score}% similarity with brand "${brand.name}"`,
        });
      }
    }

    // Score and rank products
    for (const product of productCandidates) {
      const score = calculateSimilarityScore(source, product.name);
      if (score >= this.config.lowConfidenceThreshold) {
        const commonTokens = findCommonTokens(source, product.name);
        candidates.push({
          entityType: 'PRODUCT',
          entityId: product.id,
          entityName: product.name,
          brandId: product.brand?.id,
          brandName: product.brand?.name,
          divisionId: product.division?.id,
          divisionName: product.division?.name,
          score,
          confidence: scoreToConfidence(score),
          reason: 'fuzzy_similarity',
          matchedTokens: commonTokens,
          explanation: product.brand
            ? `${score}% similarity with product "${product.name}" (Brand: ${product.brand.name})`
            : `${score}% similarity with master medicine item "${product.name}"`,
        });
      }
    }

    // Score and rank variants
    for (const variant of variantCandidates) {
      const score = calculateSimilarityScore(source, variant.variant_name);
      if (score >= this.config.lowConfidenceThreshold) {
        const commonTokens = findCommonTokens(source, variant.variant_name);
        candidates.push({
          entityType: 'VARIANT',
          entityId: variant.id,
          entityName: variant.variant_name,
          parentProductId: variant.product.id,
          parentProductName: variant.product.name,
          brandId: variant.product.brand?.id,
          brandName: variant.product.brand?.name,
          score,
          confidence: scoreToConfidence(score),
          reason: 'fuzzy_similarity',
          matchedTokens: commonTokens,
          explanation: `${score}% similarity with variant "${variant.variant_name}"`,
        });
      }
    }

    // Sort by score descending, then by confidence level
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      const confidenceOrder = { EXACT: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NO_MATCH: 4 };
      return confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    });

    // Return top candidates (total across all entity types)
    return candidates.slice(0, this.config.maxCandidatesPerLevel * 2);
  }

  /**
   * Extract brand candidates with blocking
   */
  private extractBrandCandidates(
    source: string,
    brands: Array<{ id: string; name: string; normalized_name: string }>
  ): Array<{ id: string; name: string; normalized_name: string }> {
    return extractCandidatesByTokenOverlap(
      source,
      brands.map((b) => ({ name: b.name, id: b.id, normalized_name: b.normalized_name })),
      30,
      this.config.maxCandidatesPerLevel
    ) as any;
  }

  /**
   * Extract product candidates with blocking
   */
  private extractProductCandidates(
    source: string,
    products: Array<{
      id: string;
      name: string;
      normalized_name: string;
      brand: { id: string; name: string } | null;
      division: { id: string; name: string } | null;
    }>
  ): Array<{
    id: string;
    name: string;
    normalized_name: string;
    brand: { id: string; name: string } | null;
    division: { id: string; name: string } | null;
  }> {
    return extractCandidatesByTokenOverlap(
      source,
      products.map((p) => ({ name: p.name, id: p.id, normalized_name: p.normalized_name, brand: p.brand })),
      30,
      this.config.maxCandidatesPerLevel
    ) as any;
  }

  /**
   * Extract variant candidates with blocking
   */
  private extractVariantCandidates(
    source: string,
    variants: Array<{
      id: string;
      variant_name: string;
      normalized_variant_name: string | null;
      product: { id: string; name: string; brand: { id: string; name: string } | null };
    }>
  ): Array<{
    id: string;
    variant_name: string;
    normalized_variant_name: string | null;
    product: { id: string; name: string; brand: { id: string; name: string } | null };
  }> {
    return extractCandidatesByTokenOverlap(
      source,
      variants.map((v) => ({
        name: v.variant_name,
        id: v.id,
        variant_name: v.variant_name,
        normalized_variant_name: v.normalized_variant_name,
        product: v.product,
      })),
      30,
      this.config.maxCandidatesPerLevel
    ) as any;
  }

  /**
   * Get configuration
   */
  getConfig(): MatchingConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<MatchingConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Export singleton instance
export const matchingEngine = new MatchingEngine();

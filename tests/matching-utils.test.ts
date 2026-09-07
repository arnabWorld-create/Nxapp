import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText,
  calculateSimilarityScore,
  calculateTokenOverlap,
  findCommonTokens,
  tokenize,
  scoreToConfidence,
} from '../src/lib/matching/utils';

/**
 * PHASE 3 - BRAND/PRODUCT/VARIANT MATCHING TESTS
 * 
 * Focus on core matching logic without extensive database operations
 */

describe('Phase 3 - Matching Engine Utilities', () => {
  describe('Text Normalization', () => {
    it('normalizeText should lowercase', () => {
      assert.strictEqual(normalizeText('ABTER'), 'abter');
      assert.strictEqual(normalizeText('AbTeR'), 'abter');
    });

    it('normalizeText should trim whitespace', () => {
      assert.strictEqual(normalizeText('  ABTER  '), 'abter');
      assert.strictEqual(normalizeText('\tABTER\n'), 'abter');
    });

    it('normalizeText should collapse multiple spaces', () => {
      assert.strictEqual(normalizeText('ABTER  BRAND'), 'abter brand');
      assert.strictEqual(normalizeText('ABTER   TRIO'), 'abter trio');
    });

    it('normalizeText should remove special characters', () => {
      assert.strictEqual(normalizeText('ABTER-BRAND'), 'abter brand');
      assert.strictEqual(normalizeText('ABTER.TRIO'), 'abter trio');
    });

    it('normalizeText is case-insensitive for comparison', () => {
      const a = normalizeText('ABTER');
      const b = normalizeText('abter');
      assert.strictEqual(a, b);
    });
  });

  describe('Tokenization', () => {
    it('tokenize should split by spaces', () => {
      assert.deepStrictEqual(tokenize('ABTER BRAND PRODUCT'), ['abter', 'brand', 'product']);
    });

    it('tokenize should handle single word', () => {
      assert.deepStrictEqual(tokenize('ABTER'), ['abter']);
    });

    it('tokenize should handle empty string', () => {
      assert.deepStrictEqual(tokenize(''), []);
    });
  });

  describe('Similarity Scoring', () => {
    it('calculateSimilarityScore should return 100 for identical strings', () => {
      assert.strictEqual(calculateSimilarityScore('ABTER', 'ABTER'), 100);
      assert.strictEqual(calculateSimilarityScore('abter', 'ABTER'), 100);
    });

    it('calculateSimilarityScore should penalize different strings', () => {
      const score = calculateSimilarityScore('ABTER', 'BETA');
      assert(score < 100 && score >= 0);
    });

    it('calculateSimilarityScore should handle substring matches', () => {
      const score = calculateSimilarityScore('ABTER', 'ABTER XR');
      assert(score > 50 && score < 100);
    });

    it('calculateSimilarityScore should be deterministic', () => {
      const score1 = calculateSimilarityScore('ABTER XR', 'ABTER');
      const score2 = calculateSimilarityScore('ABTER XR', 'ABTER');
      assert.strictEqual(score1, score2);
    });
  });

  describe('Token Overlap', () => {
    it('calculateTokenOverlap should measure word overlap', () => {
      const overlap = calculateTokenOverlap('ABTER BRAND', 'ABTER TRIO');
      assert(overlap > 0 && overlap <= 100);
    });

    it('calculateTokenOverlap should return 100 for identical tokens', () => {
      const overlap = calculateTokenOverlap('ABTER', 'ABTER');
      assert.strictEqual(overlap, 100);
    });

    it('calculateTokenOverlap should handle no overlap', () => {
      const overlap = calculateTokenOverlap('ABTER', 'ZEBRA');
      assert.strictEqual(overlap, 0);
    });

    it('calculateTokenOverlap should be percentage-based', () => {
      const overlap1 = calculateTokenOverlap('ABTER BRAND', 'ABTER');
      assert(overlap1 > 0 && overlap1 <= 100);
    });
  });

  describe('Common Tokens', () => {
    it('findCommonTokens should extract shared words', () => {
      const tokens = findCommonTokens('ABTER BRAND PRODUCT', 'ABTER TRIO XR');
      assert(tokens.includes('abter'));
    });

    it('findCommonTokens should return empty for no matches', () => {
      const tokens = findCommonTokens('ABTER', 'ZEBRA');
      assert.strictEqual(tokens.length, 0);
    });

    it('findCommonTokens should handle multiple shared words', () => {
      const tokens = findCommonTokens('ABTER BRAND PRODUCT', 'ABTER BRAND XR');
      assert.strictEqual(tokens.length, 2);
      assert(tokens.includes('abter'));
      assert(tokens.includes('brand'));
    });
  });

  describe('Confidence Classification', () => {
    it('scoreToConfidence should classify EXACT for 100', () => {
      assert.strictEqual(scoreToConfidence(100), 'EXACT');
    });

    it('scoreToConfidence should classify HIGH for 90-99', () => {
      assert.strictEqual(scoreToConfidence(95), 'HIGH');
      assert.strictEqual(scoreToConfidence(90), 'HIGH');
      assert.strictEqual(scoreToConfidence(99), 'HIGH');
    });

    it('scoreToConfidence should classify MEDIUM for 75-89', () => {
      assert.strictEqual(scoreToConfidence(82), 'MEDIUM');
      assert.strictEqual(scoreToConfidence(75), 'MEDIUM');
      assert.strictEqual(scoreToConfidence(89), 'MEDIUM');
    });

    it('scoreToConfidence should classify LOW for 60-74', () => {
      assert.strictEqual(scoreToConfidence(68), 'LOW');
      assert.strictEqual(scoreToConfidence(60), 'LOW');
      assert.strictEqual(scoreToConfidence(74), 'LOW');
    });

    it('scoreToConfidence should classify NO_MATCH for <60', () => {
      assert.strictEqual(scoreToConfidence(50), 'NO_MATCH');
      assert.strictEqual(scoreToConfidence(0), 'NO_MATCH');
      assert.strictEqual(scoreToConfidence(59), 'NO_MATCH');
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle empty strings gracefully', () => {
      const score = calculateSimilarityScore('', 'ABTER');
      assert.strictEqual(score, 0);
    });

    it('should handle very long strings', () => {
      const long = 'A'.repeat(1000);
      const score = calculateSimilarityScore(long, long);
      assert.strictEqual(score, 100);
    });

    it('should handle special characters consistently', () => {
      const score1 = calculateSimilarityScore('ABTER-BRAND', 'ABTER BRAND');
      assert(score1 > 50);
    });

    it('should handle case variations consistently', () => {
      const score1 = calculateSimilarityScore('ABTER', 'abter');
      const score2 = calculateSimilarityScore('AbTeR', 'aBtEr');
      assert.strictEqual(score1, 100);
      assert.strictEqual(score2, 100);
    });
  });

  describe('Core Business Rules', () => {
    it('should never auto-confirm fuzzy matches', () => {
      // This is enforced at engine level, but we can verify scores don't mislead
      const score = calculateSimilarityScore('ABTER', 'ABTER XR');
      assert(score < 100, 'Similar names should not have perfect score');
    });

    it('should distinguish between Brand and Product names', () => {
      // Both can have similar names, so fuzzy matching must require review
      const score_brand = calculateSimilarityScore('ABTER', 'ABTER');
      const score_product = calculateSimilarityScore('ABTER', 'ABTER TRIO');
      
      assert.strictEqual(score_brand, 100);
      assert(score_product < 100);
    });

    it('should preserve different source names', () => {
      const name1 = 'ABTER';
      const name2 = 'ABTER XR';
      const name3 = 'ABTER SP';
      
      assert.notStrictEqual(normalizeText(name1), normalizeText(name2));
      assert.notStrictEqual(normalizeText(name2), normalizeText(name3));
    });

    it('should not merge ABter and ABter Trio automatically', () => {
      const score = calculateSimilarityScore('ABTER', 'ABTER TRIO');
      assert(score < 90, 'These should not be HIGH confidence match');
    });

    it('should not merge ABter XR and ABter automatically', () => {
      const score = calculateSimilarityScore('ABTER XR', 'ABTER');
      assert(score < 90, 'These should not be HIGH confidence match');
    });
  });

  describe('Matching Scenarios', () => {
    it('should detect exact brand match', () => {
      const source = 'ABTER';
      const candidate = 'ABTER';
      const score = calculateSimilarityScore(source, candidate);
      assert.strictEqual(score, 100, 'Exact brand match should be 100%');
    });

    it('should detect ambiguous product vs brand', () => {
      const brandName = 'ABTER';
      const productName = 'ABTER';
      
      // Both could match, but require different confirmation
      const score = calculateSimilarityScore(brandName, productName);
      assert.strictEqual(score, 100, 'Names match');
      // Hierarchy ambiguity must be resolved by user
    });

    it('should detect variant similarity', () => {
      const source = 'ABTER TRIO XR';
      const variant = 'ABTER TRIO XR';
      const score = calculateSimilarityScore(source, variant);
      assert.strictEqual(score, 100);
    });

    it('should rank similar candidates by score', () => {
      const source = 'ABTER TRIO';
      const candidates = [
        { name: 'ZEBRA', score: calculateSimilarityScore(source, 'ZEBRA') },
        { name: 'ABTER', score: calculateSimilarityScore(source, 'ABTER') },
        { name: 'ABTER TRIO', score: calculateSimilarityScore(source, 'ABTER TRIO') },
        { name: 'ABTER XR', score: calculateSimilarityScore(source, 'ABTER XR') },
      ];

      // Verify ranking
      const sorted = [...candidates].sort((a, b) => b.score - a.score);
      assert.strictEqual(sorted[0].name, 'ABTER TRIO');
    });
  });

  describe('Performance Characteristics', () => {
    it('normalizeText should be fast', () => {
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        normalizeText('ABTER BRAND PRODUCT XR SP');
      }
      const duration = performance.now() - start;
      assert(duration < 100, 'Should normalize 1000 strings in <100ms');
    });

    it('calculateSimilarityScore should be fast', () => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        calculateSimilarityScore('ABTER BRAND PRODUCT', 'ABTER TRIO XR');
      }
      const duration = performance.now() - start;
      assert(duration < 100, 'Should score 100 pairs in <100ms');
    });
  });
});

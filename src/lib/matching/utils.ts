/**
 * Utility functions for matching engine
 */

/**
 * Normalize text for comparison
 * - lowercase
 * - trim
 * - remove extra whitespace
 * - remove special characters
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ')  // Replace special chars with space
    .replace(/\s+/g, ' ')      // Collapse multiple spaces
    .trim();                   // Trim again
}

export function normalizeSourceItemName(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/bronkosyp\b/g, 'bronksyp')
    .replace(/(?<=[a-z])\.(?=\d)/gi, ' ')
    .replace(/(\d)\s*\.\s*(\d)/g, (_, whole: string, fraction: string) => `${whole}.${fraction}`)
    .replace(/(?<!\d)\.(\d)/g, (_, fraction: string) => `0.${fraction}`)
    .replace(/[^\w\s.]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+tab$/, '')
    .trim();
}

export function normalizeSafeMatchName(text: string): string {
  let normalized = text.toLowerCase().trim();
  normalized = normalized
    .replace(/bronkosyp\b/g, 'bronksyp')
    .replace(/(?<=[a-z])\.(?=\d)/gi, ' ')
    .replace(/(\d)\s*\.\s*(\d)/g, (_, whole: string, fraction: string) => `${whole}.${fraction}`)
    .replace(/(?<!\d)\.(\d)/g, (_, fraction: string) => `0.${fraction}`)
    .replace(/[^\w\s.]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\b(\d{1,2})\s+(\d{1,2})(?=\s*(?:mg|g)\b)/g, (_, whole: string, fraction: string) => `${whole}.${fraction}`)
    .replace(/(?<=\d)\s*mg\b/g, '')
    .replace(/\bmoisturizing\b/g, 'moist')
    .replace(/\b(?:tab|tablet|tablets|cap|caps|capsule|capsules|syp|syrup)\b/g, ' ')
    .replace(/\bcream(?=\s+\d+(?:\.\d+)?\s*(?:ml|l|gm|g)\b)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

export function normalizeCompactSafeMatchName(text: string): string {
  return normalizeSafeMatchName(text).replace(/\s+/g, '');
}

/**
 * Calculate Levenshtein distance (character-level edit distance)
 * Lower score = more similar
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate similarity score as percentage (0-100)
 * Based on Levenshtein distance
 */
export function calculateSimilarityScore(a: string, b: string): number {
  const normalized_a = normalizeText(a);
  const normalized_b = normalizeText(b);

  if (normalized_a === normalized_b) return 100;
  if (!normalized_a || !normalized_b) return 0;

  const maxLen = Math.max(normalized_a.length, normalized_b.length);
  const distance = levenshteinDistance(normalized_a, normalized_b);
  const similarity = Math.max(0, (maxLen - distance) / maxLen);

  return Math.round(similarity * 100);
}

/**
 * Extract tokens from text (words)
 */
export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((token) => token.length > 0);
}

/**
 * Calculate token overlap percentage
 * How many tokens from source appear in candidate
 */
export function calculateTokenOverlap(source: string, candidate: string): number {
  const sourceTokens = new Set(tokenize(source));
  const candidateTokens = new Set(tokenize(candidate));

  if (sourceTokens.size === 0) return 0;

  const overlap = Array.from(sourceTokens).filter((token) => candidateTokens.has(token)).length;

  return Math.round((overlap / sourceTokens.size) * 100);
}

/**
 * Find common tokens between two texts
 */
export function findCommonTokens(source: string, candidate: string): string[] {
  const sourceTokens = new Set(tokenize(source));
  const candidateTokens = new Set(tokenize(candidate));

  return Array.from(sourceTokens).filter((token) => candidateTokens.has(token));
}

/**
 * Extract candidates by prefix (for blocking strategy)
 * Returns candidates that start with same first significant token
 */
export function extractCandidatesByPrefix<T extends { name: string }>(
  source: string,
  candidates: T[],
  maxResults: number = 10
): T[] {
  const tokens = tokenize(source);
  if (tokens.length === 0) return candidates.slice(0, maxResults);

  const firstToken = tokens[0];

  // Exact prefix match first
  let results = candidates.filter((c) => tokenize(c.name)[0] === firstToken);

  // If too few, add partial prefix matches
  if (results.length < maxResults) {
    const partial = candidates.filter(
      (c) => !results.includes(c) && normalizeText(c.name).startsWith(firstToken.substring(0, 3))
    );
    results = results.concat(partial);
  }

  // If still too few, add all
  if (results.length < maxResults) {
    results = results.concat(candidates.filter((c) => !results.includes(c)));
  }

  return results.slice(0, maxResults);
}

/**
 * Extract candidates by token overlap (blocking strategy)
 * Returns candidates with significant token overlap
 */
export function extractCandidatesByTokenOverlap<T extends { name: string }>(
  source: string,
  candidates: T[],
  minOverlapPercentage: number = 30,
  maxResults: number = 10
): T[] {
  const sourceTokens = new Set(tokenize(source));

  if (sourceTokens.size === 0) return candidates.slice(0, maxResults);

  const scored = candidates.map((c) => ({
    candidate: c,
    overlap: calculateTokenOverlap(source, c.name),
  }));

  return scored
    .filter((s) => s.overlap >= minOverlapPercentage)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, maxResults)
    .map((s) => s.candidate);
}

/**
 * Confidence level based on similarity score
 */
export function scoreToConfidence(score: number): 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_MATCH' {
  if (score === 100) return 'EXACT';
  if (score >= 90) return 'HIGH';
  if (score >= 75) return 'MEDIUM';
  if (score >= 60) return 'LOW';
  return 'NO_MATCH';
}

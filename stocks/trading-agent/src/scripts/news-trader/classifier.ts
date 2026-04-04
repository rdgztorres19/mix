/**
 * classifier.ts — Headline classification for news-reaction trading.
 *
 * Classifies news headlines into catalyst categories and determines trade direction.
 * Reuses keyword logic from stock-training/src/catalyst/catalyst-classifier.ts.
 */

export type CatalystCategory =
  | 'BUYOUT_ACQUISITION_MERGER'
  | 'FDA_APPROVAL'
  | 'EARNINGS_BEAT'
  | 'SPLIT'
  | 'OFFERING_DILUTION'
  | 'PARTNERSHIP'
  | 'CONTRACT_AWARD'
  | 'SHORT_SQUEEZE'
  | 'UPLISTING'
  | 'PHASE_TRIAL'
  | 'ANALYST_DOWNGRADE'
  | 'SEC_INVESTIGATION'
  | 'LAWSUIT'
  | 'EARNINGS_MISS'
  | 'HALT_PENDING'
  | 'OTHER';

const CATEGORY_KEYWORDS: Record<CatalystCategory, string[]> = {
  BUYOUT_ACQUISITION_MERGER: ['buyout', 'acquisition', 'merger', 'takeover', 'acquired', 'to acquire', 'definitive agreement'],
  FDA_APPROVAL: ['fda approv', 'approved by fda', 'fda clearance', 'breakthrough therapy', 'fda grants'],
  EARNINGS_BEAT: ['earnings beat', 'beat estimates', 'exceeds expectations', 'quarterly results beat', 'tops estimates'],
  EARNINGS_MISS: ['earnings miss', 'misses estimate', 'below expectations', 'disappointing results', 'revenue miss'],
  SPLIT: ['stock split', 'reverse split', 'split announced'],
  OFFERING_DILUTION: [
    'offering', 'dilution', 'shares offered', 'secondary offering', 'atm offering',
    'registered direct', 'public offering', 'shelf registration', 'priced offering',
    'direct offering', 'underwritten offering',
  ],
  PARTNERSHIP: ['partnership', 'major partnership', 'exclusive deal', 'collaboration', 'strategic alliance'],
  CONTRACT_AWARD: ['contract award', 'government contract', 'contract win', 'receives notice to proceed', 'awarded contract'],
  SHORT_SQUEEZE: ['short squeeze', 'most shorted'],
  UPLISTING: ['nasdaq uplisting', 'nyse uplisting', 'uplist'],
  PHASE_TRIAL: ['phase 3', 'pivotal trial', 'trial success', 'clinical trial', 'positive data'],
  ANALYST_DOWNGRADE: ['analyst downgrade', 'price target lowered', 'downgrade'],
  SEC_INVESTIGATION: ['investigation', 'sec inquiry', 'sec charges'],
  LAWSUIT: ['lawsuit', 'sued', 'litigation', 'class action'],
  HALT_PENDING: ['trading halt', 'halt news pending', 'halted'],
  OTHER: [],
};

// Categories that signal LONG direction (stock should go UP)
const LONG_CATEGORIES: Set<CatalystCategory> = new Set([
  'BUYOUT_ACQUISITION_MERGER',
  'FDA_APPROVAL',
  'EARNINGS_BEAT',
  'CONTRACT_AWARD',
  'SHORT_SQUEEZE',
  'UPLISTING',
  'PHASE_TRIAL',
  'PARTNERSHIP',
]);

// Categories that signal SHORT direction (stock should go DOWN)
const SHORT_CATEGORIES: Set<CatalystCategory> = new Set([
  'OFFERING_DILUTION',
  'ANALYST_DOWNGRADE',
  'SEC_INVESTIGATION',
  'LAWSUIT',
  'EARNINGS_MISS',
]);

// STRONG = higher conviction, use full TP/SL
const STRONG_CATEGORIES: Set<CatalystCategory> = new Set([
  'BUYOUT_ACQUISITION_MERGER',
  'FDA_APPROVAL',
  'EARNINGS_BEAT',
  'CONTRACT_AWARD',
  'SHORT_SQUEEZE',
  'OFFERING_DILUTION',
]);

export interface ClassificationResult {
  category: CatalystCategory;
  strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  is_dilutive: boolean;
  direction: 'long' | 'short' | 'skip';
}

export function classifyHeadline(headline: string): ClassificationResult {
  const text = headline.toLowerCase();
  let category: CatalystCategory = 'OTHER';
  let is_dilutive = false;

  // Check for halt first — skip these (too unpredictable)
  if (CATEGORY_KEYWORDS.HALT_PENDING.some(k => text.includes(k))) {
    return { category: 'HALT_PENDING', strength: 'NONE', is_dilutive: false, direction: 'skip' };
  }

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === 'OTHER' || cat === 'HALT_PENDING') continue;
    if (keywords.some(k => text.includes(k))) {
      category = cat as CatalystCategory;
      if (cat === 'OFFERING_DILUTION') is_dilutive = true;
      break;
    }
  }

  // Determine strength
  let strength: ClassificationResult['strength'];
  if (STRONG_CATEGORIES.has(category)) {
    strength = 'STRONG';
  } else if (category === 'OTHER') {
    strength = 'NONE';
  } else if (SHORT_CATEGORIES.has(category)) {
    strength = 'MODERATE';
  } else {
    strength = 'MODERATE';
  }

  // Determine direction
  let direction: ClassificationResult['direction'];
  if (LONG_CATEGORIES.has(category)) {
    direction = 'long';
  } else if (SHORT_CATEGORIES.has(category)) {
    direction = 'short';
  } else {
    direction = 'skip';
  }

  return { category, strength, is_dilutive, direction };
}

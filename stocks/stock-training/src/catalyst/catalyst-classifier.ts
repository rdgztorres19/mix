/**
 * Classifies news headlines into catalyst categories (buyout, split, FDA, etc.)
 * Aligned with trading-agent news.tool.ts keyword logic.
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
  | 'OTHER';

const CATEGORY_KEYWORDS: Record<CatalystCategory, string[]> = {
  BUYOUT_ACQUISITION_MERGER: ['buyout', 'acquisition', 'merger', 'takeover', 'acquired'],
  FDA_APPROVAL: ['fda approv', 'approved', 'fda clearance', 'breakthrough therapy'],
  EARNINGS_BEAT: ['earnings beat', 'beat estimates', 'quarterly results beat', 'exceeds expectations'],
  SPLIT: ['stock split', 'reverse split', 'split announced'],
  OFFERING_DILUTION: [
    'offering', 'dilution', 'shares offered', 'secondary offering', 'atm offering',
    'registered direct', 'public offering', 'shelf registration',
  ],
  PARTNERSHIP: ['partnership', 'major partnership', 'exclusive deal', 'collaboration'],
  CONTRACT_AWARD: ['contract award', 'government contract', 'contract win'],
  SHORT_SQUEEZE: ['short squeeze', 'halted', 'resumed trading'],
  UPLISTING: ['nasdaq uplisting', 'nyse uplisting', 'uplist'],
  PHASE_TRIAL: ['phase 3', 'pivotal trial', 'trial success', 'clinical trial'],
  ANALYST_DOWNGRADE: ['analyst downgrade', 'price target lowered', 'downgrade'],
  SEC_INVESTIGATION: ['investigation', 'sec', 'sec inquiry'],
  LAWSUIT: ['lawsuit', 'sued', 'litigation'],
  OTHER: [],
};

export interface ClassifiedCatalyst {
  category: CatalystCategory;
  is_dilutive: boolean;
  strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  raw_type: string;
}

/**
 * Classify a headline into catalyst category using keyword matching.
 * For LLM-based classification, use scoreHeadlines from news-fetcher.
 */
export function classifyHeadline(title: string): ClassifiedCatalyst {
  const text = title.toLowerCase();
  let category: CatalystCategory = 'OTHER';
  let is_dilutive = false;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === 'OTHER') continue;
    if (keywords.some((k) => text.includes(k))) {
      category = cat as CatalystCategory;
      if (cat === 'OFFERING_DILUTION') is_dilutive = true;
      break;
    }
  }

  // Strength from category
  let strength: ClassifiedCatalyst['strength'] = 'MODERATE';
  if (['BUYOUT_ACQUISITION_MERGER', 'FDA_APPROVAL', 'EARNINGS_BEAT', 'CONTRACT_AWARD', 'SHORT_SQUEEZE'].includes(category)) {
    strength = 'STRONG';
  } else if (['OFFERING_DILUTION', 'ANALYST_DOWNGRADE', 'SEC_INVESTIGATION', 'LAWSUIT'].includes(category)) {
    strength = 'WEAK';
  } else if (['PARTNERSHIP', 'UPLISTING', 'PHASE_TRIAL'].includes(category)) {
    strength = 'MODERATE';
  }

  return {
    category,
    is_dilutive,
    strength,
    raw_type: title.slice(0, 100),
  };
}

export interface NewsItem {
    title: string;
    publisher: string;
    published_at: string;
    url: string;
    age_minutes: number;
}
export interface CatalystAnalysis {
    ticker: string;
    headlines: NewsItem[];
    catalyst_strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
    catalyst_type: string;
    justifies_move: boolean;
    is_dilutive: boolean;
    confidence: number;
    summary: string;
    trade_implication: string;
}
export declare function scoreHeadlines(headlines: NewsItem[]): Promise<{
    strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
    catalyst_type: string;
    is_dilutive: boolean;
    justifies_move: boolean;
}>;
export declare function fetchYahooNews(ticker: string): Promise<NewsItem[]>;
export declare function fetchFinvizNews(ticker: string): Promise<NewsItem[]>;
export declare function createNewsTool(): any;

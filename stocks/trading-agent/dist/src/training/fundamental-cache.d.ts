export interface Fundamentals {
    sharesOutstanding: number | null;
    marketCap: number | null;
}
export declare function getFundamentals(symbol: string): Promise<Fundamentals>;

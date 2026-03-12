export interface AlpacaAccount {
    equity: number;
    buying_power: number;
    cash: number;
}
export interface AlpacaPosition {
    symbol: string;
    qty: number;
    avg_entry_price: number;
    current_price: number;
    market_value: number;
    unrealized_pl: number;
}
export interface AlpacaOrder {
    id: string;
    symbol: string;
    qty: string;
    side: string;
    type: string;
    status: string;
    filled_avg_price: string | null;
    filled_qty: string;
    order_class?: string;
    legs?: AlpacaOrder[];
}
type TimeInForce = 'day' | 'gtc';
type BracketOptions = {
    takeProfitPct?: number;
    stopLossPct?: number;
    entryAggressivenessPct?: number;
    timeInForce?: TimeInForce;
    cancelAfterMs?: number;
};
export declare class AlpacaTraderService {
    private readonly logger;
    private readonly client;
    private readonly enabled;
    private static readonly DEFAULT_CANCEL_AFTER_MS;
    private static readonly MIN_STOP_DIFF;
    constructor();
    isEnabled(): boolean;
    getAccount(): Promise<AlpacaAccount>;
    getPosition(symbol: string): Promise<AlpacaPosition | null>;
    getAllPositions(): Promise<AlpacaPosition[]>;
    buyMarket(symbol: string, dollarAmount: number): Promise<AlpacaOrder>;
    sellMarket(symbol: string, qty: number): Promise<AlpacaOrder>;
    buyBracketLimit(symbol: string, dollarAmount: number, lastPrice: number, options?: BracketOptions): Promise<AlpacaOrder>;
    getOrder(orderId: string, nested?: boolean): Promise<AlpacaOrder>;
    cancelOrder(orderId: string): Promise<void>;
    private scheduleEntryOrderCancellation;
    private validateBracketInputs;
    private calculateEntryLimit;
    private calculateWholeShareQty;
    private calculateBracketExitPrices;
    private isCancelableStatus;
    private mapPosition;
    private mapOrder;
    private roundPrice;
    private toNumber;
    private ensureEnabled;
    private formatAxiosError;
    private throwAlpacaError;
}
export {};

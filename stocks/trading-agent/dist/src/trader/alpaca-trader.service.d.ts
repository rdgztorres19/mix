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
}
export declare class AlpacaTraderService {
    private readonly logger;
    private client;
    private enabled;
    constructor();
    isEnabled(): boolean;
    getAccount(): Promise<AlpacaAccount>;
    buyMarket(symbol: string, dollarAmount: number): Promise<AlpacaOrder>;
    sellMarket(symbol: string, qty: number): Promise<AlpacaOrder>;
    getPosition(symbol: string): Promise<AlpacaPosition | null>;
    getAllPositions(): Promise<AlpacaPosition[]>;
}

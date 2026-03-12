"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var AlpacaTraderService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlpacaTraderService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
let AlpacaTraderService = AlpacaTraderService_1 = class AlpacaTraderService {
    constructor() {
        this.logger = new common_1.Logger(AlpacaTraderService_1.name);
        const baseURL = process.env.ALPACA_PAPER_BASE_URL || 'https://paper-api.alpaca.markets/v2';
        const keyId = process.env.ALPACA_PAPER_KEY_ID || '';
        const secretKey = process.env.ALPACA_PAPER_SECRET_KEY || '';
        this.enabled = Boolean(keyId && secretKey);
        this.client = axios_1.default.create({
            baseURL,
            timeout: 10_000,
            headers: {
                'APCA-API-KEY-ID': keyId,
                'APCA-API-SECRET-KEY': secretKey,
                'Content-Type': 'application/json',
            },
        });
        if (this.enabled) {
            this.logger.log('AlpacaTraderService configured (paper trading)');
        }
        else {
            this.logger.warn('AlpacaTraderService: missing ALPACA_PAPER keys — trading disabled');
        }
    }
    isEnabled() {
        return this.enabled;
    }
    async getAccount() {
        this.ensureEnabled();
        const { data } = await this.client.get('/account');
        return {
            equity: this.toNumber(data.equity),
            buying_power: this.toNumber(data.buying_power),
            cash: this.toNumber(data.cash),
        };
    }
    async getPosition(symbol) {
        this.ensureEnabled();
        try {
            const { data } = await this.client.get(`/positions/${symbol.toUpperCase()}`);
            return this.mapPosition(data);
        }
        catch (error) {
            if (error?.response?.status === 404)
                return null;
            this.throwAlpacaError(`Failed to get position for ${symbol}`, error);
        }
    }
    async getAllPositions() {
        this.ensureEnabled();
        const { data } = await this.client.get('/positions');
        return data.map((position) => this.mapPosition(position));
    }
    async buyMarket(symbol, dollarAmount) {
        this.ensureEnabled();
        if (!Number.isFinite(dollarAmount) || dollarAmount <= 0) {
            throw new Error(`Invalid dollarAmount for ${symbol}: ${dollarAmount}`);
        }
        const payload = {
            symbol: symbol.toUpperCase(),
            notional: dollarAmount.toFixed(2),
            side: 'buy',
            type: 'market',
            time_in_force: 'day',
        };
        this.logger.log(`BUY MARKET ${symbol.toUpperCase()} notional=$${dollarAmount.toFixed(2)}`);
        try {
            const { data } = await this.client.post('/orders', payload);
            return this.mapOrder(data);
        }
        catch (error) {
            this.throwAlpacaError(`Failed market buy for ${symbol}`, error);
        }
    }
    async sellMarket(symbol, qty) {
        this.ensureEnabled();
        if (!Number.isFinite(qty) || qty <= 0) {
            throw new Error(`Invalid sell qty for ${symbol}: ${qty}`);
        }
        const payload = {
            symbol: symbol.toUpperCase(),
            qty: String(qty),
            side: 'sell',
            type: 'market',
            time_in_force: 'day',
        };
        this.logger.log(`SELL MARKET ${symbol.toUpperCase()} qty=${qty}`);
        try {
            const { data } = await this.client.post('/orders', payload);
            return this.mapOrder(data);
        }
        catch (error) {
            this.throwAlpacaError(`Failed market sell for ${symbol}`, error);
        }
    }
    async buyBracketLimit(symbol, dollarAmount, lastPrice, options = {}) {
        this.ensureEnabled();
        this.validateBracketInputs(symbol, dollarAmount, lastPrice);
        const takeProfitPct = options.takeProfitPct ?? 0.02;
        const stopLossPct = options.stopLossPct ?? 0.03;
        const entryAggressivenessPct = options.entryAggressivenessPct ?? 0.001;
        const timeInForce = options.timeInForce ?? 'day';
        const cancelAfterMs = options.cancelAfterMs ?? AlpacaTraderService_1.DEFAULT_CANCEL_AFTER_MS;
        const symbolUpper = symbol.toUpperCase();
        const entryLimitNum = this.calculateEntryLimit(lastPrice, entryAggressivenessPct);
        const qty = this.calculateWholeShareQty(dollarAmount, entryLimitNum, symbolUpper);
        const { takeProfit, stopLoss } = this.calculateBracketExitPrices(entryLimitNum, takeProfitPct, stopLossPct);
        const payload = {
            symbol: symbolUpper,
            qty: String(qty),
            side: 'buy',
            type: 'limit',
            time_in_force: timeInForce,
            limit_price: this.roundPrice(entryLimitNum),
            order_class: 'bracket',
            take_profit: {
                limit_price: this.roundPrice(takeProfit),
            },
            stop_loss: {
                stop_price: this.roundPrice(stopLoss),
            },
        };
        this.logger.log(`BUY BRACKET ${symbolUpper} notional=$${dollarAmount.toFixed(2)} ` +
            `entry=${payload.limit_price} tp=${payload.take_profit.limit_price} ` +
            `sl=${payload.stop_loss.stop_price} qty=${qty} tif=${timeInForce}`);
        this.logger.debug?.(`BUY BRACKET payload ${symbolUpper}: ${JSON.stringify(payload)}`);
        try {
            const { data } = await this.client.post('/orders', payload);
            const order = this.mapOrder(data);
            this.scheduleEntryOrderCancellation(order.id, symbolUpper, cancelAfterMs);
            return order;
        }
        catch (error) {
            this.throwAlpacaError(`Failed bracket buy for ${symbolUpper}`, error);
        }
    }
    async getOrder(orderId, nested = false) {
        this.ensureEnabled();
        try {
            const { data } = await this.client.get('/orders/' + orderId, {
                params: nested ? { nested: true } : undefined,
            });
            return this.mapOrder(data);
        }
        catch (error) {
            this.throwAlpacaError(`Failed to get order ${orderId}`, error);
        }
    }
    async cancelOrder(orderId) {
        this.ensureEnabled();
        try {
            await this.client.delete(`/orders/${orderId}`);
        }
        catch (error) {
            this.throwAlpacaError(`Failed to cancel order ${orderId}`, error);
        }
    }
    scheduleEntryOrderCancellation(orderId, symbol, cancelAfterMs) {
        setTimeout(async () => {
            try {
                const order = await this.getOrder(orderId, true);
                if (order.status === 'filled') {
                    this.logger.log(`Order ${orderId} (${symbol}) filled within ${cancelAfterMs}ms.`);
                    return;
                }
                if (!this.isCancelableStatus(order.status)) {
                    this.logger.log(`Order ${orderId} (${symbol}) not canceled; status=${order.status}`);
                    return;
                }
                await this.cancelOrder(orderId);
                if (order.status === 'partially_filled') {
                    this.logger.warn(`Order ${orderId} (${symbol}) partially filled after ${cancelAfterMs}ms; remainder canceled.`);
                    const position = await this.getPosition(symbol);
                    if (position && position.qty > 0) {
                        this.logger.warn(`Open position remains after partial fill: ${symbol} qty=${position.qty}. ` +
                            `Decide whether to close it or re-protect it.`);
                    }
                    return;
                }
                this.logger.warn(`Order ${orderId} (${symbol}) canceled after ${cancelAfterMs}ms; status=${order.status}`);
            }
            catch (error) {
                this.logger.error(`Polling/cancel error for ${symbol}: ${this.formatAxiosError(error)}`);
            }
        }, cancelAfterMs);
    }
    validateBracketInputs(symbol, dollarAmount, lastPrice) {
        if (!symbol?.trim()) {
            throw new Error('Symbol is required');
        }
        if (!Number.isFinite(dollarAmount) || dollarAmount <= 0) {
            throw new Error(`Invalid dollarAmount for ${symbol}: ${dollarAmount}`);
        }
        if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
            throw new Error(`Invalid lastPrice for ${symbol}: ${lastPrice}`);
        }
    }
    calculateEntryLimit(lastPrice, entryAggressivenessPct) {
        const rawEntryPrice = lastPrice * (1 + entryAggressivenessPct);
        const entryLimit = this.toNumber(this.roundPrice(rawEntryPrice));
        if (!Number.isFinite(entryLimit) || entryLimit <= 0) {
            throw new Error(`Invalid entry limit generated: ${entryLimit}`);
        }
        return entryLimit;
    }
    calculateWholeShareQty(dollarAmount, entryLimit, symbol) {
        const rawQty = dollarAmount / entryLimit;
        if (!Number.isFinite(rawQty) || rawQty <= 0) {
            throw new Error(`Invalid qty for ${symbol}: dollarAmount=${dollarAmount}, entryLimit=${entryLimit}`);
        }
        const qty = Math.floor(rawQty);
        if (qty < 1) {
            throw new Error(`Dollar amount too small for ${symbol}: cannot buy at least 1 share with bracket order`);
        }
        return qty;
    }
    calculateBracketExitPrices(entryPrice, takeProfitPct, stopLossPct) {
        let takeProfit = this.toNumber(this.roundPrice(entryPrice * (1 + takeProfitPct)));
        let stopLoss = this.toNumber(this.roundPrice(entryPrice * (1 - stopLossPct)));
        if (entryPrice - stopLoss < AlpacaTraderService_1.MIN_STOP_DIFF) {
            stopLoss = entryPrice - AlpacaTraderService_1.MIN_STOP_DIFF;
        }
        if (stopLoss <= 0) {
            stopLoss = 0.01;
        }
        if (takeProfit <= entryPrice) {
            takeProfit = entryPrice + AlpacaTraderService_1.MIN_STOP_DIFF;
        }
        if (stopLoss >= entryPrice) {
            stopLoss = entryPrice - AlpacaTraderService_1.MIN_STOP_DIFF;
        }
        if (takeProfit <= stopLoss) {
            takeProfit = entryPrice + AlpacaTraderService_1.MIN_STOP_DIFF * 2;
            stopLoss = entryPrice - AlpacaTraderService_1.MIN_STOP_DIFF;
        }
        return { takeProfit, stopLoss };
    }
    isCancelableStatus(status) {
        return [
            'new',
            'accepted',
            'pending_new',
            'accepted_for_bidding',
            'partially_filled',
            'stopped',
            'held',
            'calculated',
        ].includes(status ?? '');
    }
    mapPosition(data) {
        return {
            symbol: data.symbol,
            qty: this.toNumber(data.qty),
            avg_entry_price: this.toNumber(data.avg_entry_price),
            current_price: this.toNumber(data.current_price),
            market_value: this.toNumber(data.market_value),
            unrealized_pl: this.toNumber(data.unrealized_pl),
        };
    }
    mapOrder(data) {
        return {
            id: data.id,
            symbol: data.symbol,
            qty: data.qty,
            side: data.side,
            type: data.type,
            status: data.status,
            filled_avg_price: data.filled_avg_price,
            filled_qty: data.filled_qty,
            order_class: data.order_class,
            legs: data.legs?.map((leg) => this.mapOrder(leg)),
        };
    }
    roundPrice(price) {
        if (!Number.isFinite(price))
            return '0.00';
        return price >= 1 ? price.toFixed(2) : price.toFixed(4);
    }
    toNumber(value) {
        if (value === null || value === undefined)
            return 0;
        const parsed = typeof value === 'number' ? value : parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    ensureEnabled() {
        if (!this.enabled) {
            throw new Error('AlpacaTraderService disabled – missing API keys');
        }
    }
    formatAxiosError(error) {
        const status = error?.response?.status;
        const data = error?.response?.data;
        return `status=${status ?? 'unknown'} data=${JSON.stringify(data) || error.message}`;
    }
    throwAlpacaError(context, error) {
        const message = `${context}: ${this.formatAxiosError(error)}`;
        this.logger.error(message);
        throw new Error(message);
    }
};
exports.AlpacaTraderService = AlpacaTraderService;
AlpacaTraderService.DEFAULT_CANCEL_AFTER_MS = 30_000;
AlpacaTraderService.MIN_STOP_DIFF = 0.01;
exports.AlpacaTraderService = AlpacaTraderService = AlpacaTraderService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], AlpacaTraderService);
//# sourceMappingURL=alpaca-trader.service.js.map
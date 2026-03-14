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
var AutoTraderService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoTraderService = void 0;
const common_1 = require("@nestjs/common");
const node_notifier_1 = __importDefault(require("node-notifier"));
const predictor_service_1 = require("../predictor/predictor.service");
const alpaca_trader_service_1 = require("./alpaca-trader.service");
const position_tracker_service_1 = require("./position-tracker.service");
let AutoTraderService = AutoTraderService_1 = class AutoTraderService {
    constructor(predictor, alpaca, positions) {
        this.predictor = predictor;
        this.alpaca = alpaca;
        this.positions = positions;
        this.logger = new common_1.Logger(AutoTraderService_1.name);
        this.predictEnabled = process.env.AUTO_PREDICT_ENABLED === 'true';
        this.tradeEnabled = process.env.AUTO_TRADE_ENABLED === 'true';
        this.threshold = parseFloat(process.env.AUTO_PREDICT_THRESHOLD ?? '0.70');
        this.tradePct = parseFloat(process.env.AUTO_TRADE_PCT ?? '0.01');
        this.exitCandles = parseInt(process.env.AUTO_TRADE_EXIT_CANDLES ?? '10', 10);
        this.logger.log(`AutoTrader | predict=${this.predictEnabled} trade=${this.tradeEnabled} ` +
            `thr=${this.threshold} pct=${this.tradePct} exitCandles=${this.exitCandles}`);
    }
    setGateway(gw) {
        this.gateway = gw;
    }
    async onCandleClosed(row) {
        if (!this.predictEnabled)
            return;
        try {
            if (this.positions.hasOpenPosition(row.symbol)) {
                await this.trackOpenPosition(row);
            }
            else {
                await this.evaluateAndTrade(row);
            }
        }
        catch (err) {
            this.logger.warn(`AutoTrader error for ${row.symbol}: ${err.message}`);
        }
    }
    async trackOpenPosition(row) {
        const elapsed = await this.positions.incrementCandles(row.symbol);
        this.logger.debug(`${row.symbol} position candle ${elapsed}/${this.exitCandles}`);
        if (elapsed >= this.exitCandles) {
            await this.closeAndSell(row);
        }
    }
    async closeAndSell(row) {
        const pos = this.positions.getOpenPosition(row.symbol);
        if (!pos)
            return;
        const exitPrice = await this.sellViaAlpaca(row.symbol, pos.qty, row.close);
        const closed = await this.positions.closePosition(row.symbol, exitPrice);
        if (!closed)
            return;
        this.notifyExit(row, closed, exitPrice);
    }
    async sellViaAlpaca(symbol, qty, fallbackPrice) {
        if (!this.alpaca.isEnabled())
            return fallbackPrice;
        try {
            const order = await this.alpaca.sellMarket(symbol, qty);
            return this.parseFillPrice(order, fallbackPrice);
        }
        catch (err) {
            this.logger.error(`Alpaca sell failed for ${symbol}, using candle close: ${err.message}`);
            return fallbackPrice;
        }
    }
    notifyExit(row, closed, exitPrice) {
        const pnl = closed.pnl ?? 0;
        this.gateway.emitTradeExit({
            symbol: row.symbol,
            date: row.date,
            time: row.candle_time_et,
            entryPrice: closed.entry_price,
            exitPrice,
            qty: closed.qty,
            pnl,
            candlesHeld: closed.candles_elapsed,
        });
        this.logger.log(`EXITED ${row.symbol}: $${exitPrice.toFixed(2)} | PnL=$${pnl.toFixed(2)} after ${closed.candles_elapsed} candles`);
    }
    async evaluateAndTrade(row) {
        const result = await this.runPrediction(row);
        this.broadcastSignal(row, result);
        if (this.shouldEnterTrade(result)) {
            await this.buyAndTrack(row);
        }
    }
    async runPrediction(row) {
        return this.predictor.predict({ ticker: row.symbol, date: row.date, candle_time_et: row.candle_time_et }, this.threshold);
    }
    broadcastSignal(row, result) {
        this.gateway.emitPredictSignal({
            symbol: row.symbol,
            date: row.date,
            time: row.candle_time_et,
            prob: result.prob,
            threshold: this.threshold,
            tradeable: result.tradeable,
            close: row.close,
        });
        this.logger.log(`${row.symbol} ${row.candle_time_et} predict: prob=${(result.prob * 100).toFixed(1)}% ` +
            `tradeable=${result.tradeable} (thr=${this.threshold})`);
    }
    shouldEnterTrade(result) {
        return result.tradeable && this.tradeEnabled && this.alpaca.isEnabled();
    }
    async buyAndTrack(row) {
        try {
            const dollarAmount = await this.calculatePositionSize();
            if (dollarAmount < 1) {
                this.logger.warn(`${row.symbol}: position size too small ($${dollarAmount.toFixed(2)})`);
                return;
            }
            const order = await this.alpaca.buyBracketLimit(row.symbol, dollarAmount, row.close);
            const fillPrice = this.parseFillPrice(order, row.close);
            const qty = this.parseFillQty(order, dollarAmount, row.close);
            await this.positions.openPosition(row.symbol, fillPrice, qty, row.candle_idx, order.id);
            this.notifyEntry(row, fillPrice, qty, dollarAmount, order.id);
        }
        catch (err) {
            console.log(err);
            this.logger.error(`Failed to enter ${row.symbol}: ${err.message}`);
        }
    }
    async calculatePositionSize() {
        const account = await this.alpaca.getAccount();
        return account.equity * this.tradePct;
    }
    parseFillPrice(order, fallback) {
        return order.filled_avg_price ? parseFloat(order.filled_avg_price) : fallback;
    }
    parseFillQty(order, dollarAmount, closePrice) {
        return order.filled_qty ? parseFloat(order.filled_qty) : dollarAmount / closePrice;
    }
    notifyEntry(row, price, qty, dollarAmount, orderId) {
        this.gateway.emitTradeEntry({
            symbol: row.symbol,
            date: row.date,
            time: row.candle_time_et,
            price,
            qty,
            dollarAmount,
            orderId,
        });
        this.logger.log(`ENTERED ${row.symbol}: qty=${qty.toFixed(4)} @ $${price.toFixed(2)} ($${dollarAmount.toFixed(2)})`);
        node_notifier_1.default.notify({
            title: 'Compra ejecutada',
            message: `${row.symbol} @ $${price.toFixed(2)} · $${dollarAmount.toFixed(2)} (${row.candle_time_et})`,
            sound: true,
            timeout: 10,
        });
    }
};
exports.AutoTraderService = AutoTraderService;
exports.AutoTraderService = AutoTraderService = AutoTraderService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [predictor_service_1.PredictorService,
        alpaca_trader_service_1.AlpacaTraderService,
        position_tracker_service_1.PositionTrackerService])
], AutoTraderService);
//# sourceMappingURL=auto-trader.service.js.map
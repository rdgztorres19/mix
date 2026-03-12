/**
 * AutoTraderService: orchestrator called after every candle close.
 *
 * Flow per symbol:
 *  1. If open position → increment candle counter → if >= EXIT_CANDLES, sell & emit
 *  2. If no position → run ML predict (historical mode) → emit signal to UI
 *  3. If tradeable (prob >= threshold) AND AUTO_TRADE → buy via Alpaca → emit entry
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AutoTraderService", {
    enumerable: true,
    get: function() {
        return AutoTraderService;
    }
});
const _common = require("@nestjs/common");
const _nodenotifier = /*#__PURE__*/ _interop_require_default(require("node-notifier"));
const _predictorservice = require("../predictor/predictor.service");
const _alpacatraderservice = require("./alpaca-trader.service");
const _positiontrackerservice = require("./position-tracker.service");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let AutoTraderService = class AutoTraderService {
    /** Called by CollectorService to inject the gateway (avoids circular module dep). */ setGateway(gw) {
        this.gateway = gw;
    }
    // ═══════════════════════════════════════════════════════════════════════
    // Main entry point
    // ═══════════════════════════════════════════════════════════════════════
    async onCandleClosed(row) {
        if (!this.predictEnabled) return;
        try {
            if (this.positions.hasOpenPosition(row.symbol)) {
                await this.trackOpenPosition(row);
            } else {
                await this.evaluateAndTrade(row);
            }
        } catch (err) {
            this.logger.warn(`AutoTrader error for ${row.symbol}: ${err.message}`);
        }
    }
    // ═══════════════════════════════════════════════════════════════════════
    // Open-position management
    // ═══════════════════════════════════════════════════════════════════════
    async trackOpenPosition(row) {
        const elapsed = await this.positions.incrementCandles(row.symbol);
        this.logger.debug(`${row.symbol} position candle ${elapsed}/${this.exitCandles}`);
        if (elapsed >= this.exitCandles) {
            await this.closeAndSell(row);
        }
    }
    async closeAndSell(row) {
        const pos = this.positions.getOpenPosition(row.symbol);
        if (!pos) return;
        const exitPrice = await this.sellViaAlpaca(row.symbol, pos.qty, row.close);
        const closed = await this.positions.closePosition(row.symbol, exitPrice);
        if (!closed) return;
        this.notifyExit(row, closed, exitPrice);
    }
    async sellViaAlpaca(symbol, qty, fallbackPrice) {
        if (!this.alpaca.isEnabled()) return fallbackPrice;
        try {
            const order = await this.alpaca.sellMarket(symbol, qty);
            return this.parseFillPrice(order, fallbackPrice);
        } catch (err) {
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
            candlesHeld: closed.candles_elapsed
        });
        this.logger.log(`EXITED ${row.symbol}: $${exitPrice.toFixed(2)} | PnL=$${pnl.toFixed(2)} after ${closed.candles_elapsed} candles`);
    }
    // ═══════════════════════════════════════════════════════════════════════
    // Predict → signal → optional entry
    // ═══════════════════════════════════════════════════════════════════════
    async evaluateAndTrade(row) {
        const result = await this.runPrediction(row);
        this.broadcastSignal(row, result);
        if (this.shouldEnterTrade(result)) {
            await this.buyAndTrack(row);
        }
    }
    async runPrediction(row) {
        return this.predictor.predict({
            ticker: row.symbol,
            date: row.date,
            candle_time_et: row.candle_time_et
        }, this.threshold);
    }
    broadcastSignal(row, result) {
        this.gateway.emitPredictSignal({
            symbol: row.symbol,
            date: row.date,
            time: row.candle_time_et,
            prob: result.prob,
            threshold: this.threshold,
            tradeable: result.tradeable,
            close: row.close
        });
        this.logger.log(`${row.symbol} ${row.candle_time_et} predict: prob=${(result.prob * 100).toFixed(1)}% ` + `tradeable=${result.tradeable} (thr=${this.threshold})`);
    }
    shouldEnterTrade(result) {
        return result.tradeable && this.tradeEnabled && this.alpaca.isEnabled();
    }
    // ═══════════════════════════════════════════════════════════════════════
    // Buy entry
    // ═══════════════════════════════════════════════════════════════════════
    async buyAndTrack(row) {
        try {
            const dollarAmount = await this.calculatePositionSize();
            if (dollarAmount < 1) {
                this.logger.warn(`${row.symbol}: position size too small ($${dollarAmount.toFixed(2)})`);
                return;
            }
            // Use bracket order with aggressive limit entry, TP 2% and SL 1.5%
            const order = await this.alpaca.buyBracketLimit(row.symbol, dollarAmount, row.close);
            const fillPrice = this.parseFillPrice(order, row.close);
            const qty = this.parseFillQty(order, dollarAmount, row.close);
            await this.positions.openPosition(row.symbol, fillPrice, qty, row.candle_idx, order.id);
            this.notifyEntry(row, fillPrice, qty, dollarAmount, order.id);
        } catch (err) {
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
            orderId
        });
        this.logger.log(`ENTERED ${row.symbol}: qty=${qty.toFixed(4)} @ $${price.toFixed(2)} ($${dollarAmount.toFixed(2)})`);
        _nodenotifier.default.notify({
            title: 'Compra ejecutada',
            message: `${row.symbol} @ $${price.toFixed(2)} · $${dollarAmount.toFixed(2)} (${row.candle_time_et})`,
            sound: true,
            timeout: 10
        });
    }
    constructor(predictor, alpaca, positions){
        this.predictor = predictor;
        this.alpaca = alpaca;
        this.positions = positions;
        this.logger = new _common.Logger(AutoTraderService.name);
        this.predictEnabled = process.env.AUTO_PREDICT_ENABLED === 'true';
        this.tradeEnabled = process.env.AUTO_TRADE_ENABLED === 'true';
        this.threshold = parseFloat(process.env.AUTO_PREDICT_THRESHOLD ?? '0.70');
        this.tradePct = parseFloat(process.env.AUTO_TRADE_PCT ?? '0.01');
        this.exitCandles = parseInt(process.env.AUTO_TRADE_EXIT_CANDLES ?? '10', 10);
        this.logger.log(`AutoTrader | predict=${this.predictEnabled} trade=${this.tradeEnabled} ` + `thr=${this.threshold} pct=${this.tradePct} exitCandles=${this.exitCandles}`);
    }
};
AutoTraderService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _predictorservice.PredictorService === "undefined" ? Object : _predictorservice.PredictorService,
        typeof _alpacatraderservice.AlpacaTraderService === "undefined" ? Object : _alpacatraderservice.AlpacaTraderService,
        typeof _positiontrackerservice.PositionTrackerService === "undefined" ? Object : _positiontrackerservice.PositionTrackerService
    ])
], AutoTraderService);

//# sourceMappingURL=auto-trader.service.js.map
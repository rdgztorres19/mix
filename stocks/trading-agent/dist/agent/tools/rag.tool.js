// @ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createRagTool", {
    enumerable: true,
    get: function() {
        return createRagTool;
    }
});
const _tools = require("@langchain/core/tools");
const _zod = require("zod");
function createRagTool(ragService) {
    return (0, _tools.tool)(async ({ query, strategy_filter })=>{
        try {
            let results;
            if (strategy_filter) {
                results = await ragService.searchByStrategy(query, strategy_filter, 3);
            } else {
                results = await ragService.searchGeneral(query, 4);
            }
            if (!results.length) {
                return 'No relevant knowledge found for this query.';
            }
            return ragService.formatResultsForLLM(results);
        } catch (err) {
            return `Error searching knowledge base: ${err.message}`;
        }
    }, {
        name: 'search_trading_knowledge',
        description: 'Search the trading knowledge base for strategies, entry/exit rules, risk management, and stock selection criteria. ' + 'Use this tool to understand HOW to trade a specific pattern or situation. ' + 'Optionally filter by strategy name for more precise results. ' + 'Strategies: BULL_FLAG, ABCD, ORB, VWAP_REVERSAL, VWAP_FALSE_BREAKOUT, VWAP_MA_TREND, FALLEN_ANGEL, GENERAL, RISK_MANAGEMENT, STOCK_SELECTION, LEVEL2.',
        schema: _zod.z.object({
            query: _zod.z.string().describe('Natural language query about trading strategy, entry rules, stop loss, etc.'),
            strategy_filter: _zod.z.string().optional().describe('Optional strategy filter: BULL_FLAG, ABCD, ORB, VWAP_REVERSAL, VWAP_FALSE_BREAKOUT, VWAP_MA_TREND, FALLEN_ANGEL, RISK_MANAGEMENT, STOCK_SELECTION, GENERAL')
        })
    });
}

//# sourceMappingURL=rag.tool.js.map
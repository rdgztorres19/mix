"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get createPool () {
        return createPool;
    },
    get getPrevCloseMap () {
        return getPrevCloseMap;
    },
    get getStockProfiles () {
        return getStockProfiles;
    },
    get getUniverseSymbols () {
        return getUniverseSymbols;
    }
});
const _promise = /*#__PURE__*/ _interop_require_default(require("mysql2/promise"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function createPool() {
    return _promise.default.createPool({
        host: process.env.MYSQL_HOST ?? 'localhost',
        port: parseInt(process.env.MYSQL_PORT ?? '3306', 10),
        user: process.env.MYSQL_USER ?? 'root',
        password: process.env.MYSQL_PASSWORD ?? '',
        database: process.env.MYSQL_DATABASE_TRAINING ?? 'stock_training',
        waitForConnections: true,
        connectionLimit: 5
    });
}
async function getUniverseSymbols(pool) {
    const [rows] = await pool.query(`SELECT symbol FROM screener_assets
     WHERE status = 'active' AND tradable = 1
       AND class = 'us_equity' AND exchange != 'OTC'
     ORDER BY symbol`);
    return rows.map((r)=>String(r.symbol));
}
async function getPrevCloseMap(pool, date) {
    const [rows] = await pool.query(`SELECT symbol, prev_close FROM screener_prev_close WHERE as_of_date = ?`, [
        date
    ]);
    const map = new Map();
    for (const r of rows){
        const v = Number(r.prev_close);
        if (Number.isFinite(v) && v > 0) map.set(String(r.symbol).toUpperCase(), v);
    }
    return map;
}
async function getStockProfiles(pool) {
    const [rows] = await pool.query(`SELECT symbol, shares_outstanding, market_cap FROM stock_profile`);
    const map = new Map();
    for (const r of rows){
        map.set(String(r.symbol).toUpperCase(), {
            shares_outstanding: Number(r.shares_outstanding ?? 0),
            market_cap: Number(r.market_cap ?? 0)
        });
    }
    return map;
}

//# sourceMappingURL=db.js.map
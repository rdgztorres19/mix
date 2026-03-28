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
    get barsPath () {
        return barsPath;
    },
    get dataDir () {
        return dataDir;
    },
    get hasLocalData () {
        return hasLocalData;
    },
    get prevClosePath () {
        return prevClosePath;
    },
    get readLocalBars () {
        return readLocalBars;
    },
    get readLocalPrevClose () {
        return readLocalPrevClose;
    },
    get writeLocalBars () {
        return writeLocalBars;
    },
    get writeLocalPrevClose () {
        return writeLocalPrevClose;
    }
});
const _fs = /*#__PURE__*/ _interop_require_wildcard(require("fs"));
const _promises = /*#__PURE__*/ _interop_require_wildcard(require("node:fs/promises"));
const _zlib = /*#__PURE__*/ _interop_require_wildcard(require("zlib"));
const _util = require("util");
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
const gzip = (0, _util.promisify)(_zlib.gzip);
const gunzip = (0, _util.promisify)(_zlib.gunzip);
const DATA_ROOT = _path.default.resolve(__dirname, '../../../data');
function dataDir(date) {
    return _path.default.join(DATA_ROOT, date);
}
function barsPath(date) {
    return _path.default.join(DATA_ROOT, date, 'bars-1m.json.gz');
}
function prevClosePath(date) {
    return _path.default.join(DATA_ROOT, date, 'prev-close.json.gz');
}
async function hasLocalData(date) {
    try {
        await _promises.access(barsPath(date), _fs.constants.R_OK);
        return true;
    } catch  {
        return false;
    }
}
async function readLocalBars(date) {
    const buf = await _promises.readFile(barsPath(date));
    const json = (await gunzip(buf)).toString('utf-8');
    const obj = JSON.parse(json);
    const map = new Map();
    for (const [sym, bars] of Object.entries(obj)){
        map.set(sym, bars);
    }
    return map;
}
async function writeLocalBars(date, bars) {
    await _promises.mkdir(dataDir(date), {
        recursive: true
    });
    const obj = {};
    bars.forEach((barArr, sym)=>{
        obj[sym] = barArr;
    });
    const compressed = await gzip(Buffer.from(JSON.stringify(obj), 'utf-8'));
    await _promises.writeFile(barsPath(date), compressed);
}
async function readLocalPrevClose(date) {
    const buf = await _promises.readFile(prevClosePath(date));
    const json = (await gunzip(buf)).toString('utf-8');
    const obj = JSON.parse(json);
    const map = new Map();
    for (const [sym, val] of Object.entries(obj)){
        map.set(sym, val);
    }
    return map;
}
async function writeLocalPrevClose(date, map) {
    await _promises.mkdir(dataDir(date), {
        recursive: true
    });
    const obj = {};
    map.forEach((val, sym)=>{
        obj[sym] = val;
    });
    const compressed = await gzip(Buffer.from(JSON.stringify(obj), 'utf-8'));
    await _promises.writeFile(prevClosePath(date), compressed);
}

//# sourceMappingURL=file-cache.js.map
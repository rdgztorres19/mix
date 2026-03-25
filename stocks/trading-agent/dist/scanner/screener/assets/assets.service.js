"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AssetsService", {
    enumerable: true,
    get: function() {
        return AssetsService;
    }
});
const _common = require("@nestjs/common");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let AssetsService = class AssetsService {
    // Placeholder: implement logic to load assets from DB or fetch from Alpaca
    async getAllSymbols() {
        // ...fetch from DB/cache or call Alpaca if not present
        return [];
    }
    constructor(){
        this.logger = new _common.Logger(AssetsService.name);
    }
};
AssetsService = _ts_decorate([
    (0, _common.Injectable)()
], AssetsService);

//# sourceMappingURL=assets.service.js.map
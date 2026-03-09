"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScannerModule = void 0;
const common_1 = require("@nestjs/common");
const scanner_service_1 = require("./scanner.service");
const scanner_controller_1 = require("./scanner.controller");
const scanner_cron_1 = require("./scanner.cron");
const mysql_training_repository_1 = require("./mysql/mysql-training.repository");
const momo_datasource_1 = require("./datasource/momo-datasource");
const mysql_datasource_1 = require("./datasource/mysql-datasource");
const datasource_factory_1 = require("./datasource/datasource.factory");
let ScannerModule = class ScannerModule {
};
exports.ScannerModule = ScannerModule;
exports.ScannerModule = ScannerModule = __decorate([
    (0, common_1.Module)({
        providers: [
            scanner_service_1.ScannerService,
            scanner_cron_1.ScannerCron,
            mysql_training_repository_1.MysqlTrainingRepository,
            momo_datasource_1.MomoDataSource,
            mysql_datasource_1.MysqlDataSource,
            datasource_factory_1.StockDataSourceFactory,
        ],
        controllers: [scanner_controller_1.ScannerController],
        exports: [scanner_service_1.ScannerService, mysql_training_repository_1.MysqlTrainingRepository],
    })
], ScannerModule);
//# sourceMappingURL=scanner.module.js.map
#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { resolve } from 'path';
import Redis from 'ioredis';

const __filename = fileURLToPath(import.meta.url);

class RedisAnalyzer {
    constructor() {
        // Configuración de conexión Redis usando ioredis
        this.client = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 7878,
            password: process.env.REDIS_PASSWORD || undefined,
            db: process.env.REDIS_DB || 0,
            lazyConnect: true,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3,
        });

        this.client.on('error', (err) => {
            console.error('❌ Redis Client Error:', err);
        });

        this.client.on('connect', () => {
            console.log('✅ Connected to Redis');
        });

        this.client.on('ready', () => {
            console.log('🚀 Redis client ready');
        });
    }

    async connect() {
        try {
            await this.client.ping();
            console.log('🔗 Redis connection established');
        } catch (error) {
            console.error('❌ Failed to connect to Redis:', error.message);
            throw error;
        }
    }

    async scanAllKeys() {
        console.log('🔍 Scanning all Redis keys...\n');
        
        const keys = [];
        const prefixStats = {};
        let totalMemory = 0;
        let cursor = '0';

        const startTime = Date.now();

        do {
            try {
                // SCAN con cursor para obtener keys de forma eficiente usando ioredis
                const result = await this.client.scan(cursor, 'MATCH', '*', 'COUNT', 1000);
                cursor = result[0];
                const batchKeys = result[1];

                if (batchKeys.length > 0) {
                    keys.push(...batchKeys);

                    // Procesar keys en paralelo para mejor performance
                    const keyPromises = batchKeys.map(async (key) => {
                        try {
                            // Obtener memoria usada por el key y tipo
                            const [memory, type] = await Promise.all([
                                this.client.memory('usage', key).catch(() => 0),
                                this.client.type(key)
                            ]);

                            const keyInfo = {
                                key,
                                memory: memory || 0,
                                type,
                                prefix: this.extractPrefix(key)
                            };

                            return keyInfo;
                        } catch (error) {
                            console.warn(`⚠️ Error analyzing key ${key}:`, error.message);
                            return {
                                key,
                                memory: 0,
                                type: 'unknown',
                                prefix: this.extractPrefix(key)
                            };
                        }
                    });

                    const keyInfos = await Promise.all(keyPromises);

                    // Procesar estadísticas
                    for (const keyInfo of keyInfos) {
                        totalMemory += keyInfo.memory;

                        const prefix = keyInfo.prefix;
                        if (!prefixStats[prefix]) {
                            prefixStats[prefix] = {
                                count: 0,
                                memory: 0,
                                examples: [],
                                types: new Set()
                            };
                        }
                        
                        prefixStats[prefix].count++;
                        prefixStats[prefix].memory += keyInfo.memory;
                        prefixStats[prefix].types.add(keyInfo.type);
                        
                        // Guardar ejemplos (máximo 3 por prefijo)
                        if (prefixStats[prefix].examples.length < 3) {
                            prefixStats[prefix].examples.push(keyInfo.key);
                        }
                    }

                    // Mostrar progreso
                    if (keys.length % 5000 === 0) {
                        console.log(`📊 Processed ${keys.length} keys so far...`);
                    }
                }

            } catch (error) {
                console.error(`❌ Error during scan at cursor ${cursor}:`, error.message);
                break;
            }

        } while (cursor !== '0');

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        // Convertir Sets a Arrays para el reporte
        Object.values(prefixStats).forEach(stats => {
            stats.types = Array.from(stats.types);
        });

        return {
            totalKeys: keys.length,
            totalMemory,
            prefixStats,
            duration,
            keys: keys.slice(0, 100) // Solo los primeros 100 para evitar overflow
        };
    }

    extractPrefix(key) {
        // Extraer prefijo basado en separadores comunes
        const separators = [':', '_', '-', '.'];
        
        for (const sep of separators) {
            const index = key.indexOf(sep);
            if (index > 0) {
                return key.substring(0, index) + sep + '*';
            }
        }
        
        // Si no hay separadores, usar primeros caracteres
        return key.length > 3 ? key.substring(0, 3) + '*' : key;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async getRedisInfo() {
        try {
            return await this.client.info();
        } catch (error) {
            console.error('❌ Error getting Redis info:', error);
            return '';
        }
    }

    async generateReport(analysis) {
        console.log('\n' + '='.repeat(80));
        console.log('📊 REDIS DATABASE ANALYSIS REPORT');
        console.log('='.repeat(80));

        // Información general
        console.log('\n🔧 CONNECTION INFO:');
        console.log(`   Host: ${this.client.options.host || 'localhost'}`);
        console.log(`   Port: ${this.client.options.port || 6379}`);
        console.log(`   Database: ${this.client.options.db || 0}`);
        console.log(`   Scan Duration: ${analysis.duration}s`);
        console.log(`   Status: ${this.client.status}`);

        // Estadísticas generales
        console.log('\n📈 GENERAL STATISTICS:');
        console.log(`   Total Keys: ${analysis.totalKeys.toLocaleString()}`);
        console.log(`   Total Memory Usage: ${this.formatBytes(analysis.totalMemory)}`);
        if (analysis.totalKeys > 0) {
            console.log(`   Average Memory per Key: ${this.formatBytes(analysis.totalMemory / analysis.totalKeys)}`);
        }

        // Estadísticas por prefijo
        console.log('\n🏷️  KEY PREFIXES ANALYSIS:');
        console.log('-'.repeat(90));
        console.log(this.sprintf('%-25s %8s %12s %10s %s', 'Prefix', 'Count', 'Memory', 'Types', 'Examples'));
        console.log('-'.repeat(90));

        // Ordenar prefijos por cantidad de keys
        const sortedPrefixes = Object.entries(analysis.prefixStats)
            .sort(([,a], [,b]) => b.count - a.count)
            .slice(0, 20); // Top 20 prefijos

        for (const [prefix, stats] of sortedPrefixes) {
            const examples = stats.examples.join(', ');
            const examplesStr = examples.length > 30 ? examples.substring(0, 30) + '...' : examples;
            const typesStr = stats.types ? stats.types.join(',') : 'unknown';
            
            console.log(this.sprintf('%-25s %8s %12s %10s %s', 
                prefix, 
                stats.count.toLocaleString(), 
                this.formatBytes(stats.memory),
                typesStr,
                examplesStr
            ));
        }

        // Top keys por memoria
        console.log('\n💾 MEMORY DISTRIBUTION:');
        for (const [prefix, stats] of sortedPrefixes.slice(0, 10)) {
            const percentage = ((stats.memory / analysis.totalMemory) * 100).toFixed(1);
            console.log(`   ${prefix}: ${percentage}% (${this.formatBytes(stats.memory)})`);
        }

        // Información del servidor Redis
        try {
            console.log('\n🖥️  REDIS SERVER INFO:');
            const info = await this.getRedisInfo();
            const lines = info.split('\r\n');
            const relevantInfo = lines.filter(line => 
                line.includes('redis_version') || 
                line.includes('used_memory_human') ||
                line.includes('connected_clients') ||
                line.includes('total_commands_processed')
            );
            
            for (const line of relevantInfo) {
                if (line.includes(':')) {
                    const [key, value] = line.split(':');
                    console.log(`   ${key}: ${value}`);
                }
            }
        } catch (error) {
            console.warn('⚠️ Could not retrieve Redis server info');
        }

        console.log('\n' + '='.repeat(80));
        console.log('✅ Analysis completed successfully!');
        console.log('='.repeat(80));
    }

    // Función helper para formatear strings (similar a printf)
    sprintf(format, ...args) {
        let i = 0;
        return format.replace(/%-?([0-9]*)s/g, (match, width) => {
            const arg = String(args[i++] || '');
            const w = parseInt(width) || 0;
            if (match.startsWith('%-')) {
                return arg.padEnd(w);
            } else {
                return arg.padStart(w);
            }
        });
    }

    async disconnect() {
        await this.client.quit();
        console.log('\n👋 Disconnected from Redis');
    }
}

// Función principal
async function main() {
    const analyzer = new RedisAnalyzer();
    
    try {
        console.log('🚀 Starting Redis Database Analysis...\n');
        
        // Conectar a Redis
        await analyzer.connect();
        
        // Realizar análisis
        const analysis = await analyzer.scanAllKeys();
        
        // Generar reporte
        await analyzer.generateReport(analysis);
        
    } catch (error) {
        console.error('💥 Analysis failed:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    } finally {
        await analyzer.disconnect();
    }
}

// Ejecutar si es llamado directamente
const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
    main().catch(console.error);
}

export default RedisAnalyzer;
const { Client } = require('ssh2');
const axios = require('axios');
const https = require('https');

// Configuración
const SSH_CONFIG = {
    host: '192.168.1.212',
    port: 22,
    username: 'sdc',
    password: 'sbrQp10'
};

const API_CONFIG = {
    url: 'https://192.168.1.212/gateway/identity/v1/health',
    params: {
        services: 'tree-api,identity-api,sde-socket-api'
    }
};

// Crear agente HTTPS que ignore certificados self-signed
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Función para ejecutar comando SSH
function executeSSHCommand(command, useSudo = false) {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        let connectionClosed = false;
        
        const cleanup = () => {
            if (!connectionClosed) {
                connectionClosed = true;
                conn.end();
            }
        };
        
        const timeout = setTimeout(() => {
            console.log('⚠️  Timeout esperando respuesta del comando');
            cleanup();
            resolve({ code: 0, output: '', errorOutput: '', timeout: true });
        }, 15000); // 15 segundos timeout
        
        conn.on('ready', () => {
            console.log('✓ Conexión SSH establecida');
            console.log(`📝 Ejecutando: ${useSudo ? 'sudo ' : ''}${command}`);
            
            const finalCommand = useSudo ? `sudo -S ${command}` : command;
            
            conn.exec(finalCommand, (err, stream) => {
                if (err) {
                    clearTimeout(timeout);
                    cleanup();
                    return reject(err);
                }
                
                let output = '';
                let errorOutput = '';
                let passwordSent = false;
                
                stream.on('close', (code, signal) => {
                    clearTimeout(timeout);
                    console.log(`✓ Comando ejecutado (exit code: ${code})`);
                    if (output.trim()) console.log('   Output:', output.trim());
                    cleanup();
                    resolve({ code, output, errorOutput });
                }).on('data', (data) => {
                    output += data.toString();
                    process.stdout.write(data);
                }).stderr.on('data', (data) => {
                    const text = data.toString();
                    errorOutput += text;
                    
                    // Si detectamos el prompt de sudo y aún no hemos enviado el password
                    if (useSudo && !passwordSent && (text.includes('password') || text.includes('[sudo]'))) {
                        passwordSent = true;
                        console.log('🔐 Enviando password...');
                        stream.write(SSH_CONFIG.password + '\n');
                    } else {
                        process.stderr.write(text);
                    }
                });
            });
        });
        
        conn.on('error', (err) => {
            clearTimeout(timeout);
            console.error('✗ Error de conexión SSH:', err.message);
            cleanup();
            reject(err);
        });
        
        conn.on('close', () => {
            clearTimeout(timeout);
            if (!connectionClosed) {
                console.log('ℹ️  Conexión SSH cerrada por el servidor');
                connectionClosed = true;
            }
        });
        
        conn.connect({
            ...SSH_CONFIG,
            readyTimeout: 10000,
            keepaliveInterval: 5000
        });
    });
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Función para esperar hasta que el servicio esté reiniciando (no retorna JSON válido o error)
async function waitFor504(maxAttempts = 60, delayMs = 1000) {
    console.log('⏳ Esperando a que el servicio comience a reiniciar (deje de responder)...\n');
    let attempts = 0;
    
    while (attempts < maxAttempts) {
        attempts++;
        
        try {
            const response = await axios.get(
                API_CONFIG.url,
                {
                    params: API_CONFIG.params,
                    httpsAgent,
                    timeout: 5000,
                    validateStatus: () => true // Aceptar cualquier código de estado
                }
            );
            
            // Si el status no es 200, el servicio está fallando
            if (response.status !== 200) {
                console.log(`\n✅ Servicio está reiniciando (HTTP ${response.status} detectado en intento ${attempts})`);
                return true;
            }
            
            // Verificar si retorna JSON válido
            const isValidJson = response.data && typeof response.data === 'object';
            
            if (!isValidJson) {
                console.log(`\n✅ Servicio está reiniciando (respuesta no-JSON detectada en intento ${attempts})`);
                return true;
            }
            
            console.log(`⏳ Intento ${attempts}: Servicio respondiendo OK (200) con JSON válido, esperando...`);
            
        } catch (error) {
            // Si hay error de conexión o timeout, el servicio está caído
            if (error.response) {
                const status = error.response.status;
                console.log(`\n✅ Servicio está reiniciando (HTTP ${status} detectado en intento ${attempts})`);
                return true;
            } else if (error.code === 'ECONNREFUSED') {
                console.log(`\n✅ Servicio está reiniciando (conexión rechazada en intento ${attempts})`);
                return true;
            } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
                console.log(`\n✅ Servicio está reiniciando (timeout en intento ${attempts})`);
                return true;
            } else {
                console.log(`⚠️  Intento ${attempts}: Error ${error.message}`);
            }
        }
        
        await sleep(delayMs);
    }
    
    console.log(`\n⚠️  No se detectó reinicio después de ${attempts} intentos, continuando de todas formas...`);
    return false;
}

// Función para verificar el endpoint con reintentos
async function waitForHealthEndpoint(maxAttempts = 60, delayMs = 1000) {
    // Primero esperar hasta que el servicio esté reiniciando
    await waitFor504(60, 1000);
    
    console.log('\n⏱️  Esperando a que el servicio de health esté disponible...\n');
    const startTime = Date.now();
    let attempts = 0;
    
    console.log('\n⏱️  Esperando a que el servicio de health esté disponible...\n');
    
    while (attempts < maxAttempts) {
        attempts++;
        const attemptStartTime = Date.now();
        
        try {
            const response = await axios.get(
                API_CONFIG.url,
                {
                    params: API_CONFIG.params,
                    httpsAgent,
                    timeout: 5000,
                    validateStatus: (status) => status === 200
                }
            );
            
            const totalTime = Date.now() - startTime;
            const elapsedSeconds = (totalTime / 1000).toFixed(2);
            
            console.log(`\n✓ ¡Éxito! El servicio respondió con 200 OK`);
            console.log(`⏱️  Tiempo total desde el restart: ${elapsedSeconds} segundos`);
            console.log(`📊 Intentos realizados: ${attempts}`);
            console.log(`🏥 Health Check URL: ${API_CONFIG.url}?services=${API_CONFIG.params.services}`);
            console.log(`📦 Respuesta:`, JSON.stringify(response.data, null, 2));
            
            return {
                success: true,
                totalTimeMs: totalTime,
                totalTimeSeconds: elapsedSeconds,
                attempts,
                data: response.data
            };
            
        } catch (error) {
            const attemptTime = Date.now() - attemptStartTime;
            
            if (error.response) {
                // El servidor respondió pero con un código de error
                console.log(`⚠️  Intento ${attempts}: HTTP ${error.response.status} (${attemptTime}ms)`);
            } else if (error.code === 'ECONNREFUSED') {
                console.log(`⚠️  Intento ${attempts}: Conexión rechazada (${attemptTime}ms)`);
            } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
                console.log(`⚠️  Intento ${attempts}: Timeout (${attemptTime}ms)`);
            } else {
                console.log(`⚠️  Intento ${attempts}: ${error.message} (${attemptTime}ms)`);
            }
            
            // Esperar antes del próximo intento
            if (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`\n✗ Tiempo máximo alcanzado (${(totalTime / 1000).toFixed(2)}s)`);
    console.log(`✗ El servicio no respondió después de ${attempts} intentos`);
    
    return {
        success: false,
        totalTimeMs: totalTime,
        totalTimeSeconds: (totalTime / 1000).toFixed(2),
        attempts
    };
}

// Función principal
async function main() {
    console.log('='.repeat(60));
    console.log('🚀 Iniciando proceso de restart y monitoreo');
    console.log('='.repeat(60));
    console.log();
    
    try {
        // Paso 1: Ejecutar restart via SSH
        console.log('📡 Conectando a SSH...');
        console.log(`   Host: ${SSH_CONFIG.host}`);
        console.log(`   Usuario: ${SSH_CONFIG.username}`);
        console.log();
        
        await executeSSHCommand('service supervisor stop', true);
        await executeSSHCommand('service supervisor start', true);
        
        console.log('\n✓ Comando "service supervisor restart" ejecutado exitosamente');
        console.log();
        
        // Pequeña pausa para que el servicio comience a reiniciar
        console.log('⏸️  Esperando 2 segundos antes de comenzar a monitorear...\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Paso 2: Monitorear el endpoint de health
        const result = await waitForHealthEndpoint(100, 1000);
        
        console.log();
        console.log('='.repeat(60));
        
        if (result.success) {
            console.log('✅ PROCESO COMPLETADO EXITOSAMENTE');
        } else {
            console.log('❌ PROCESO FINALIZADO CON ERROR');
        }
        
        console.log('='.repeat(60));
        
        process.exit(result.success ? 0 : 1);
        
    } catch (error) {
        console.error();
        console.error('='.repeat(60));
        console.error('❌ ERROR CRÍTICO');
        console.error('='.repeat(60));
        console.error(error);
        process.exit(1);
    }
}

// Ejecutar
if (require.main === module) {
    main();
}

module.exports = { executeSSHCommand, waitForHealthEndpoint };


"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPythonTool = createPythonTool;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const child_process_1 = require("child_process");
const path_1 = require("path");
const RUNNER_PATH = (0, path_1.join)(process.cwd(), 'scripts', 'python-sandbox', 'run.py');
const TIMEOUT_MS = 30000;
function createPythonTool() {
    return (0, tools_1.tool)(async ({ code }) => {
        return new Promise((resolve) => {
            const proc = (0, child_process_1.spawn)('python3', [RUNNER_PATH], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const timer = setTimeout(() => {
                proc.kill('SIGTERM');
                resolve(`Timeout (${TIMEOUT_MS / 1000}s). El código excedió el tiempo límite.`);
            }, TIMEOUT_MS);
            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
            proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
            proc.on('error', (err) => {
                resolve(`Error ejecutando Python: ${err.message}. Asegúrate de tener python3 y las libs (pip install pandas numpy matplotlib).`);
            });
            proc.on('close', (code) => {
                clearTimeout(timer);
                if (code !== 0) {
                    resolve(`Python exit code ${code}\nstderr: ${stderr}\nstdout: ${stdout}`);
                    return;
                }
                try {
                    const result = JSON.parse(stdout.trim());
                    const out = result.stdout?.trim() || '';
                    const err = result.stderr?.trim() || '';
                    const ok = result.success !== false;
                    let msg = ok ? `STDOUT:\n${out}` : `ERROR:\n${result.stderr || err}`;
                    if (err && ok)
                        msg += `\n\nSTDERR:\n${err}`;
                    resolve(msg || '(sin output)');
                }
                catch {
                    resolve(stdout || stderr || '(output no parseable)');
                }
            });
            proc.stdin?.write(code, () => proc.stdin?.end());
        });
    }, {
        name: 'run_python',
        description: 'Ejecuta código Python con librerías pre-cargadas: pandas (pd), numpy (np), matplotlib.pyplot (plt), json, math. ' +
            'Usa print() para mostrar resultados. Para gráficos: plt.savefig("/tmp/chart.png") y comenta la ruta. ' +
            'Solo usar cuando necesites cálculos complejos, estadísticas o visualizaciones que otros tools no dan.',
        schema: zod_1.z.object({
            code: zod_1.z.string().describe('Código Python a ejecutar. Variables disponibles: pd, np, plt, json, math'),
        }),
    });
}
//# sourceMappingURL=python.tool.js.map
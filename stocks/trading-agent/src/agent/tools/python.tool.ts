// @ts-nocheck
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import { join } from 'path';

const RUNNER_PATH = join(process.cwd(), 'scripts', 'python-sandbox', 'run.py');
const TIMEOUT_MS = 30000;

export function createPythonTool(): any {
  return tool(
    async ({ code }) => {
      return new Promise<string>((resolve) => {
        const proc = spawn('python3', [RUNNER_PATH], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const timer = setTimeout(() => {
          proc.kill('SIGTERM');
          resolve(`Timeout (${TIMEOUT_MS / 1000}s). El código excedió el tiempo límite.`);
        }, TIMEOUT_MS);

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

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
            if (err && ok) msg += `\n\nSTDERR:\n${err}`;
            resolve(msg || '(sin output)');
          } catch {
            resolve(stdout || stderr || '(output no parseable)');
          }
        });

        proc.stdin?.write(code, () => proc.stdin?.end());
      });
    },
    {
      name: 'run_python',
      description:
        'Ejecuta código Python con librerías pre-cargadas: pandas (pd), numpy (np), matplotlib.pyplot (plt), json, math. ' +
        'Usa print() para mostrar resultados. Para gráficos: plt.savefig("/tmp/chart.png") y comenta la ruta. ' +
        'Solo usar cuando necesites cálculos complejos, estadísticas o visualizaciones que otros tools no dan.',
      schema: z.object({
        code: z.string().describe('Código Python a ejecutar. Variables disponibles: pd, np, plt, json, math'),
      }),
    },
  );
}

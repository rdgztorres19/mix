/**
 * Rate limit lock: cuando cualquier API devuelve 429, espera 1 minuto
 * y bloquea todas las peticiones concurrentes hasta que pase el cooldown.
 */

let cooldownPromise: Promise<void> = Promise.resolve();

const COOLDOWN_MS = 60_000; // 1 minuto

export async function with429Retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await cooldownPromise;
      return await fn();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 429) {
        console.warn(`[429] Rate limit. Esperando ${COOLDOWN_MS / 1000}s...`);
        cooldownPromise = new Promise((r) => setTimeout(r, COOLDOWN_MS));
        await cooldownPromise;
        cooldownPromise = Promise.resolve();
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries after 429');
}

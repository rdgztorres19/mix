import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AlpacaBatchService {
  private readonly logger = new Logger(AlpacaBatchService.name);

  // Batch request to Alpaca API for symbols, chunked and concurrent
  async fetchBatchData(symbols: string[], fetcher: (chunk: string[]) => Promise<any>, chunkSize = 200, concurrency = 5): Promise<any[]> {
    const results: any[] = [];
    const chunks = [];
    for (let i = 0; i < symbols.length; i += chunkSize) {
      chunks.push(symbols.slice(i, i + chunkSize));
    }
    let idx = 0;
    const runChunk = async () => {
      while (idx < chunks.length) {
        const myIdx = idx++;
        try {
          const res = await fetcher(chunks[myIdx]);
          results.push(res);
        } catch (e) {
          this.logger.error(`Batch chunk ${myIdx} failed`, e);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, runChunk));
    return results;
  }
}

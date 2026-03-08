#!/usr/bin/env npx ts-node
/**
 * Downloads top_gainers.json from historicalpercentgainers.com
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import axios from 'axios';

const URL = 'https://www.historicalpercentgainers.com/static/top_gainers.json';
const DATA_DIR = path.join(__dirname, '../data');
const OUTPUT_PATH = path.join(DATA_DIR, 'top_gainers.json');

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  console.log(`Downloading ${URL}...`);
  const res = await axios.get(URL, { timeout: 30000 });
  const data = res.data;
  if (!Array.isArray(data)) {
    throw new Error('Expected JSON array');
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Saved ${data.length} entries to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

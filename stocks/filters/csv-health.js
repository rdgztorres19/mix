#!/usr/bin/env node

const fs = require("fs");
const readline = require("readline");
const path = require("path");

const inputFile = process.argv[2] || "../stock-training/data/backups/training.csv";
const targetKey = process.argv[3] || "LVRO__2026-01-02";

if (!inputFile) {
  console.error("Uso: node find-key-lines.js <archivo.csv> [SYMBOL__DATE]");
  process.exit(1);
}

function detectDelimiter(line) {
  const commaCount = (line.match(/,/g) || []).length;
  const tabCount = (line.match(/\t/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

async function main() {
  const stream = fs.createReadStream(path.resolve(inputFile), { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let delimiter = ",";
  let firstSeen = false;
  let hasHeader = false;
  let lineNo = 0;
  let found = 0;

  for await (const rawLine of rl) {
    lineNo++;
    const line = String(rawLine).trimEnd();
    if (!line) continue;

    if (!firstSeen) {
      firstSeen = true;
      delimiter = detectDelimiter(line);

      const firstParts = line.split(delimiter).map(x => x.trim());
      hasHeader =
        firstParts[0]?.toLowerCase() === "symbol" ||
        firstParts.includes("close");

      if (hasHeader) continue;
    }

    const parts = line.split(delimiter);
    const symbol = String(parts[0] ?? "").trim();
    const date = String(parts[1] ?? "").trim();
    const time = String(parts[2] ?? "").trim();
    const key = `${symbol}__${date}`;

    if (key === targetKey) {
      found++;
      console.log(`MATCH #${found} | línea=${lineNo} | time=${time}`);
      console.log(line);
      console.log("----");

      if (found >= 20) break;
    }
  }

  if (!found) {
    console.log("No se encontraron filas para esa key.");
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
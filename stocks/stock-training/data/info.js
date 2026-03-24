#!/usr/bin/env node

import fs from "fs";
import readline from "readline";
import path from "path";

async function countCsvRows(filePath, options = {}) {
  const {
    hasHeader = false,
    ignoreEmptyLines = true,
  } = options;

  return new Promise((resolve, reject) => {
    let totalLines = 0;

    const stream = fs.createReadStream(filePath);

    stream.on("error", (err) => reject(err));

    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => {
      if (ignoreEmptyLines && line.trim() === "") return;
      totalLines++;
    });

    rl.on("close", () => {
      const totalRows = hasHeader && totalLines > 0 ? totalLines - 1 : totalLines;
      resolve({
        totalLines,
        totalRows,
        hasHeader,
      });
    });

    rl.on("error", (err) => reject(err));
  });
}

async function main() {
  const fileArg = process.argv[2];
  const hasHeader = process.argv.includes("--header");

  if (!fileArg) {
    console.error("Uso: node info.js <archivo.csv> [--header]");
    process.exit(1);
  }

  const filePath = path.resolve(fileArg);

  if (!fs.existsSync(filePath)) {
    console.error(`El archivo no existe: ${filePath}`);
    process.exit(1);
  }

  try {
    const result = await countCsvRows(filePath, { hasHeader });

    console.log(`Archivo: ${filePath}`);
    console.log(`Total líneas: ${result.totalLines}`);
    console.log(`Total rows: ${result.totalRows}`);
    console.log(`Header: ${result.hasHeader ? "sí" : "no"}`);
  } catch (err) {
    console.error("Error leyendo el CSV:", err.message);
    process.exit(1);
  }
}

main();
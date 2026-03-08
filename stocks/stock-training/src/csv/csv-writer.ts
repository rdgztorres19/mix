/**
 * CSV writer utilities.
 * Single responsibility: escape values, build header, format row for CSV output.
 */

import type { CsvRow } from './csv-types';
import { CSV_COLUMNS } from './csv-types';

export function escapeCsv(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function getCsvHeader(): string {
  return CSV_COLUMNS.join(',');
}

export function rowToCsv(row: CsvRow): string {
  return CSV_COLUMNS.map((col) => escapeCsv((row as Record<string, unknown>)[col])).join(',');
}

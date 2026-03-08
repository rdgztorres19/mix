/**
 * DISABLED — Las columnas de noticias (had_news, catalyst_*) fueron eliminadas del CSV.
 * No se hacen requests a Yahoo para evitar llamadas innecesarias.
 * Para reactivar: descomentar el código en fetchNewsForDate y añadir import axios.
 */
export interface NewsItem {
  title: string;
  publisher: string;
  published_at: string;
  url: string;
  date: string; // YYYY-MM-DD
}

/**
 * Fetches news for a ticker on a specific date.
 * Source: Yahoo Finance (query1.finance.yahoo.com) — NOT Alpaca.
 * Filters by date in ET (US market timezone).
 *
 * NOT USED: Las columnas de noticias (had_news, catalyst_*) fueron removidas del CSV
 * para no confundir al modelo con datos poco fiables (Yahoo solo devuelve noticias recientes).
 * Este módulo se mantiene por si se integra otra fuente de noticias históricas en el futuro.
 */
export async function fetchNewsForDate(
  _ticker: string,
  _dateStr: string,
): Promise<NewsItem[]> {
  // DISABLED: Las columnas de noticias fueron eliminadas del CSV. No hacer requests a Yahoo.
  return [];
}

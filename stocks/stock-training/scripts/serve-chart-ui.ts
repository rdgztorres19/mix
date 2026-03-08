#!/usr/bin/env tsx
/**
 * Servidor mínimo para UI de gráficos por ticker.
 * Uso: npm run chart:ui
 * Abre http://localhost:3847 — selecciona fecha, top movers, y gráfico 1m/5m.
 * Datos: solo MySQL (ejecuta npm run sync-mysql primero).
 */

import 'dotenv/config';
import * as path from 'path';
import * as http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { getDates, getTopMovers, getTickerData } from '../src/db/mysql';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3847;

type Resolution = '1m' | '5m';

const INDEX_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Training Chart — Ticker</title>
  <meta name="generator" content="serve-chart-ui-v4" />
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; padding: 0; background: #131722; color: #d1d4dc; }
    .header { padding: 12px 20px; background: #1e222d; border-bottom: 1px solid #2a2e39; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .search { display: flex; gap: 8px; align-items: center; }
    input { padding: 8px 12px; font-size: 0.95rem; border-radius: 6px; border: 1px solid #363a45; background: #131722; color: #fff; width: 100px; }
    input[type="date"] { min-width: 140px; color-scheme: dark; }
    button { padding: 8px 16px; font-size: 0.95rem; border-radius: 6px; border: none; background: #2962ff; color: #fff; cursor: pointer; font-weight: 600; }
    button:hover { background: #1e53e5; }
    .ticker-info { display: flex; align-items: center; gap: 12px; }
    .ticker-name { font-size: 1.25rem; font-weight: 700; color: #fff; }
    .ticker-price { font-size: 1.1rem; font-weight: 600; }
    .ticker-change { font-size: 1rem; font-weight: 600; }
    .ticker-change.up { color: #26a69a; }
    .ticker-change.down { color: #ef5350; }
    .metrics { display: flex; gap: 12px; flex-wrap: wrap; }
    .metric { background: #2a2e39; padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; }
    .metric-label { color: #787b86; margin-right: 4px; }
    .metric-value { color: #d1d4dc; font-weight: 500; }
    .main { padding: 16px 20px; }
    .chart-summary { color: #787b86; font-size: 0.85rem; margin-bottom: 12px; }
    #chart-container { height: 480px; border-radius: 8px; overflow: hidden; background: #131722; position: relative; }
    .chart-tooltip { position: absolute; z-index: 50; background: rgba(26,32,48,0.95); border: 1px solid #2a2e39; border-radius: 8px; padding: 10px 14px; font-size: 12px; font-family: 'JetBrains Mono', monospace; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.4); min-width: 180px; }
    .chart-tooltip .tt-time { color: #94a3b8; margin-bottom: 6px; font-size: 11px; }
    .chart-tooltip .tt-row { display: flex; justify-content: space-between; gap: 16px; }
    .chart-tooltip .tt-label { color: #64748b; }
    .chart-tooltip .tt-value { color: #e2e8f0; font-weight: 500; }
    .chart-tooltip-panel { background: #1a2030; border: 1px solid #2a2e39; border-radius: 8px; padding: 12px 16px; margin-top: 8px; font-size: 12px; font-family: 'JetBrains Mono', monospace; }
    .chart-tooltip-panel .tt-time { color: #94a3b8; font-size: 11px; margin-bottom: 6px; }
    .chart-tooltip-panel .tt-row { display: flex; justify-content: space-between; gap: 16px; margin: 2px 0; }
    .chart-tooltip-panel .tt-label { color: #64748b; }
    .chart-tooltip-panel .tt-value { color: #e2e8f0; font-weight: 500; }
    .chart-tooltip-panel .tt-section { margin-top: 10px; margin-bottom: 4px; font-size: 10px; font-weight: 600; }
    #chart-tooltip-floating { position: fixed; z-index: 9999; pointer-events: auto; max-height: 80vh; overflow-y: auto; background: rgba(26,32,48,0.98); border: 1px solid #2a2e39; border-radius: 8px; padding: 12px 16px; font-size: 12px; font-family: 'JetBrains Mono', monospace; box-shadow: 0 4px 20px rgba(0,0,0,0.5); min-width: 200px; }
    .error { color: #ef5350; padding: 16px 20px; }
    .status { color: #94a3b8; padding: 16px 20px; font-size: 0.9rem; }
    .hidden { display: none !important; }
    .evaluate-modal { display: flex; align-items: center; justify-content: center; }
    .top-movers { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .top-movers span { padding: 6px 12px; border-radius: 6px; background: #2a2e39; cursor: pointer; font-size: 0.9rem; }
    .top-movers span:hover { background: #363a45; }
    .top-movers span.up { color: #26a69a; }
    .top-movers span.down { color: #ef5350; }
    .ticker-picker-wrap { position: relative; flex: 1; max-width: 280px; overflow: visible; }
    .search { overflow: visible; }
    #tickerDropdown { position: absolute; top: calc(100% + 6px); left: 0; right: 0; background: #0f1520; border: 1px solid #2d3f55; border-radius: 10px; z-index: 100; max-height: 420px; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
    #tickerDropdown .dd-header { padding: 8px 14px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #475569; font-family: 'JetBrains Mono', monospace; }
    #tickerDropdown .dd-row { width: 100%; background: transparent; border: none; border-bottom: 1px solid #131820; padding: 10px 14px; cursor: pointer; text-align: left; display: flex; align-items: center; gap: 12px; color: inherit; font-family: inherit; }
    #tickerDropdown .dd-row:hover { background: #1a2030; }
    #tickerDropdown .dd-symbol { font-weight: 700; font-size: 14px; min-width: 64px; }
    #tickerDropdown .dd-price { font-size: 12px; color: #64748b; }
    #tickerDropdown .dd-change { font-size: 12px; font-weight: 700; min-width: 64px; }
    #tickerDropdown .dd-vol { font-size: 11px; color: #94a3b8; }
    .evaluate-modal { display: flex; align-items: center; justify-content: center; }
  </style>
</head>
<body>
  <div class="header">
    <div class="search">
      <label style="color:#787b86;font-size:0.85rem">Fecha:</label>
      <input type="date" id="dateSelect" style="padding:8px 12px;font-size:0.95rem;border-radius:6px;border:1px solid #363a45;background:#131722;color:#fff;" />
    </div>
    <div class="search" style="flex:1;max-width:480px;">
      <div class="ticker-picker-wrap">
        <input type="text" id="ticker" placeholder="Ticker (ej: SOUN, GME…) ↓ top movers" maxlength="8" autocomplete="off" style="width:100%;box-sizing:border-box;" />
        <div id="tickerDropdown" class="hidden">
          <div class="dd-header"><span>TOP MOVERS</span><span id="ddCount">0 stocks</span></div>
          <div id="tickerDropdownRows"></div>
        </div>
      </div>
      <select id="resolution" style="padding:8px 12px;font-size:0.95rem;border-radius:6px;border:1px solid #363a45;background:#131722;color:#fff;">
        <option value="1m">1 min</option>
        <option value="5m">5 min</option>
      </select>
      <button id="btnBuscar" type="button">Gráfico</button>
    </div>
    <span style="font-size:11px;color:#787b86;margin-left:8px">MySQL — http://localhost:3847 <span id="uiVersion" style="color:#22c55e">v4</span></span>
    <button id="btnEvaluar" type="button" style="margin-left:12px;background:#7c3aed;padding:6px 14px;font-size:0.85rem;">Evaluar modelo</button>
    <div id="dashboard" class="hidden">
      <div class="ticker-info">
        <span id="d-ticker" class="ticker-name"></span>
        <span id="d-price" class="ticker-price"></span>
        <span id="d-change" class="ticker-change"></span>
      </div>
      <div class="metrics">
        <span class="metric"><span class="metric-label">HOD</span><span id="d-hod" class="metric-value"></span></span>
        <span class="metric"><span class="metric-label">LOD</span><span id="d-lod" class="metric-value"></span></span>
        <span class="metric"><span class="metric-label">VWAP</span><span id="d-vwap" class="metric-value"></span></span>
        <span class="metric"><span class="metric-label">EMA9</span><span id="d-ema9" class="metric-value"></span></span>
        <span class="metric"><span class="metric-label">EMA20</span><span id="d-ema20" class="metric-value"></span></span>
        <span class="metric"><span class="metric-label">ATR</span><span id="d-atr" class="metric-value"></span></span>
        <span class="metric"><span class="metric-label">VOL</span><span id="d-vol" class="metric-value"></span></span>
        <span class="metric"><span class="metric-label">PM HIGH</span><span id="d-pmhigh" class="metric-value"></span></span>
        <span class="metric"><span class="metric-label">SHARES</span><span id="d-shares" class="metric-value"></span></span>
        <span class="metric"><span class="metric-label">MKT CAP</span><span id="d-marketcap" class="metric-value"></span></span>
      </div>
    </div>
  </div>
  <div class="main">
    <div id="topMoversSection" class="hidden" style="margin-bottom:16px;">
      <div style="color:#787b86;font-size:0.85rem;margin-bottom:8px;">Tickers disponibles (clic para ver gráfico):</div>
      <div id="topMoversList" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
    </div>
    <div id="status" class="status hidden"></div>
    <div id="error" class="error hidden"></div>
    <div id="chart-summary" class="chart-summary hidden"></div>
    <div id="chart-container" class="hidden"></div>
    <div id="chart-tooltip" class="chart-tooltip-panel hidden" style="margin-top:8px">Pasa el cursor sobre el gráfico</div>
    <div id="chart-tooltip-floating" class="chart-tooltip-panel hidden" style="position:fixed;z-index:9999;pointer-events:none;max-height:70vh;overflow-y:auto;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,0.5)"></div>
  </div>
  <div id="evaluateModal" class="hidden" style="display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,0.8);padding:24px;align-items:center;justify-content:center;box-sizing:border-box;">
    <div style="background:#1e222d;border:1px solid #2a2e39;border-radius:12px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;color:#fff;font-size:1.1rem;">Evaluación del modelo RF</h3>
        <button id="evaluateModalClose" type="button" style="background:transparent;border:none;color:#787b86;cursor:pointer;font-size:1.2rem;">×</button>
      </div>
      <div id="evaluateContent"></div>
    </div>
  </div>
  <script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js?v=2" async></script>
  <script>
    var moversCache = [];
    var lastLoadedDate = '';
    var availableDates = [];
    function apiUrl(path) {
      var base = window.location.origin;
      if (!base || base === 'null' || base.startsWith('file')) base = 'http://localhost:3847';
      return new URL(path, base).href;
    }
    var moversCache = [];
    var lastLoadedDate = '';
    var availableDates = [];
    function fmtVolShort(v) { if (v == null || isNaN(v)) return '—'; return v >= 1e6 ? (v/1e6).toFixed(1) + 'M' : v >= 1e3 ? (v/1e3).toFixed(0) + 'K' : v; }
    function renderTickerDropdown() {
      var filter = (document.getElementById('ticker') && document.getElementById('ticker').value || '').trim().toUpperCase();
      var filtered = filter ? moversCache.filter(function(m) { return m.symbol.startsWith(filter); }) : moversCache;
      var dd = document.getElementById('tickerDropdown');
      var rows = document.getElementById('tickerDropdownRows');
      var count = document.getElementById('ddCount');
      var dateEl = document.getElementById('dateSelect');
      var selDate = dateEl && dateEl.value;
      if (!dd || !rows || !count) return;
      count.textContent = filtered.length + ' stocks';
      if (filtered.length === 0) {
        var msg = '';
        if (filter) {
          msg = 'Ningún ticker coincide con «' + filter + '»';
        } else if (selDate && lastLoadedDate === selDate) {
          msg = 'Sin datos para ' + selDate + '. Ejecuta npm run sync-mysql para cargar datos.';
        } else if (selDate) {
          msg = 'Cargando tickers para ' + selDate + '…';
        } else {
          msg = 'Selecciona una fecha primero';
        }
        rows.innerHTML = '<div style="padding:20px 14px;font-size:12px;color:#475569;text-align:center;font-family:monospace">' + msg + '</div>';
        return;
      }
      rows.innerHTML = filtered.map(function(m) {
        var ch = Number(m.change_pct) * 100;
        var chClr = ch >= 0 ? '#22c55e' : '#ef4444';
        var price = m.close != null ? Number(m.close).toFixed(2) : '—';
        var vol = fmtVolShort(m.volume);
        return '<button type="button" class="dd-row dd-row-btn" data-symbol="' + m.symbol + '" style="font-family:monospace">' +
          '<div style="min-width:64px"><div class="dd-symbol" style="color:#e2e8f0">' + m.symbol + '</div><div class="dd-price">$' + price + '</div></div>' +
          '<div class="dd-change" style="color:' + chClr + '">' + (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%</div>' +
          '<div class="dd-vol">' + vol + '</div>' +
        '</button>';
      }).join('');
      rows.querySelectorAll('.dd-row-btn').forEach(function(btn) {
        btn.addEventListener('mousedown', function(e) {
          e.preventDefault();
          var sym = btn.getAttribute('data-symbol');
          document.getElementById('ticker').value = sym;
          document.getElementById('tickerDropdown').classList.add('hidden');
          loadChart();
        });
      });
    }
    function showTickerDropdown() {
      var dd = document.getElementById('tickerDropdown');
      if (dd) { dd.classList.remove('hidden'); renderTickerDropdown(); }
    }
    function hideTickerDropdown() {
      var dd = document.getElementById('tickerDropdown');
      if (dd) dd.classList.add('hidden');
    }
    async function loadMovers() {
      const dateEl = document.getElementById('dateSelect');
      const date = dateEl && dateEl.value;
      const statusEl = document.getElementById('status');
      if (!date) {
        if (statusEl) { statusEl.textContent = 'Selecciona una fecha primero (usa el calendario).'; statusEl.classList.remove('hidden'); }
        return;
      }
      if (statusEl) { statusEl.textContent = 'Cargando tickers...'; statusEl.classList.remove('hidden'); }
      var url = apiUrl('/api/top-movers?date=' + encodeURIComponent(date) + '&_=' + Date.now());
      console.log('[ChartUI] loadMovers: fetch', url);
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (!data.movers || data.movers.length === 0) {
          moversCache = [];
          lastLoadedDate = date;
          if (statusEl) { statusEl.textContent = 'Sin datos para ' + date + '. Elige una fecha con datos: ' + (availableDates.length ? availableDates.slice(0, 5).join(', ') : 'ejecuta npm run sync-mysql'); statusEl.classList.remove('hidden'); }
          return;
        }
        moversCache = data.movers;
        lastLoadedDate = date;
        renderTickerDropdown();
        if (statusEl) { statusEl.textContent = moversCache.length + ' tickers cargados. Clic en Ticker para elegir → Gráfico.'; statusEl.classList.remove('hidden'); }
      } catch (e) {
        moversCache = [];
        lastLoadedDate = date;
        if (statusEl) { statusEl.textContent = 'Error al cargar tickers. ¿MySQL corriendo?'; statusEl.classList.remove('hidden'); }
      }
    }
    function init() {
      var t = document.getElementById('ticker');
      var b = document.getElementById('btnBuscar');
      var s = document.getElementById('status');
      var dateInp = document.getElementById('dateSelect');
      function onDateChange() {
        if (dateInp && dateInp.value) {
          loadMovers();
        }
      }
      if (dateInp) {
        dateInp.addEventListener('change', onDateChange);
        dateInp.addEventListener('input', onDateChange);
      }
      if (t) {
        t.addEventListener('focus', function() { showTickerDropdown(); });
        t.addEventListener('blur', function() { setTimeout(hideTickerDropdown, 150); });
        t.addEventListener('input', function() { renderTickerDropdown(); });
      }
      if (b) b.addEventListener('click', loadChart);
      t && t.addEventListener('keydown', function(e) { if (e.key === 'Enter') loadChart(); });
      var btnEval = document.getElementById('btnEvaluar');
      var modalEval = document.getElementById('evaluateModal');
      var contentEval = document.getElementById('evaluateContent');
      var closeEval = document.getElementById('evaluateModalClose');
      if (btnEval && modalEval && contentEval) {
        btnEval.addEventListener('click', function() {
          btnEval.disabled = true;
          btnEval.textContent = 'Evaluando…';
          contentEval.innerHTML = '<p style="color:#94a3b8;">Cargando…</p>';
          modalEval.style.display = 'flex';
          modalEval.classList.remove('hidden');
          fetch(apiUrl('/api/evaluate'))
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.error) { contentEval.innerHTML = '<p style="color:#ef5350;">' + data.error + '</p>'; return; }
              var html = '<p style="color:#94a3b8;margin-bottom:12px;">Modelo multiclase (-1 Bajista, 0 Neutral, 1 Alcista)</p>';
              html += '<p style="margin-bottom:8px;">Accuracy: ' + ((data.accuracy || 0) * 100).toFixed(2) + '% | F1 macro: ' + ((data.f1_macro || 0) * 100).toFixed(2) + '%</p>';
              if (data.per_class) {
                html += '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
                html += '<tr><th style="text-align:left;padding:6px;border-bottom:1px solid #2a2e39;">Clase</th><th>Prec</th><th>Recall</th><th>F1</th></tr>';
                ['-1','0','1'].forEach(function(c) {
                  var pc = data.per_class[c];
                  if (pc) {
                    var lbl = c === '1' ? 'Alcista' : c === '-1' ? 'Bajista' : 'Neutral';
                    html += '<tr><td style="padding:6px;border-bottom:1px solid #1e293b;">' + lbl + '</td><td>' + ((pc.precision || 0) * 100).toFixed(1) + '%</td><td>' + ((pc.recall || 0) * 100).toFixed(1) + '%</td><td>' + ((pc.f1 || 0) * 100).toFixed(1) + '%</td></tr>';
                  }
                });
                html += '</table>';
              }
              if (data.confusion_matrix && data.confusion_matrix.length >= 3) {
                var cm = data.confusion_matrix;
                html += '<p style="margin-top:12px;color:#94a3b8;font-size:11px;">Matriz 3×3 (filas=real, cols=pred -1,0,1):</p>';
                html += '<pre style="font-size:11px;margin:4px 0;font-family:monospace;">     -1    0    1\n-1 ' + (cm[0] ? cm[0].join('  ') : '') + '\n 0 ' + (cm[1] ? cm[1].join('  ') : '') + '\n 1 ' + (cm[2] ? cm[2].join('  ') : '') + '</pre>';
              }
              contentEval.innerHTML = html;
            })
            .catch(function(e) {
              contentEval.innerHTML = '<p style="color:#ef5350;">Error: ' + (e.message || String(e)) + '</p>';
            })
            .finally(function() {
              btnEval.disabled = false;
              btnEval.textContent = 'Evaluar modelo';
            });
        });
      }
      if (closeEval && modalEval) {
        closeEval.addEventListener('click', function() { modalEval.style.display = 'none'; modalEval.classList.add('hidden'); });
        modalEval.addEventListener('click', function(e) { if (e.target === modalEval) { modalEval.style.display = 'none'; modalEval.classList.add('hidden'); } });
      }
      var btnEval = document.getElementById('btnEvaluar');
      var modalEval = document.getElementById('evaluateModal');
      var contentEval = document.getElementById('evaluateContent');
      var closeEval = document.getElementById('evaluateModalClose');
      if (btnEval && modalEval && contentEval) {
        btnEval.addEventListener('click', function() {
          btnEval.disabled = true;
          btnEval.textContent = 'Evaluando…';
          contentEval.innerHTML = '<p style="color:#94a3b8;">Cargando…</p>';
          modalEval.style.display = 'flex';
          modalEval.classList.remove('hidden');
          fetch(apiUrl('/api/evaluate'))
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.error) { contentEval.innerHTML = '<p style="color:#ef5350;">' + data.error + '</p>'; return; }
              var html = '<p style="color:#94a3b8;margin-bottom:12px;">Modelo multiclase (-1 Bajista, 0 Neutral, 1 Alcista)</p>';
              html += '<p style="margin-bottom:8px;">Accuracy: ' + ((data.accuracy || 0) * 100).toFixed(2) + '% | F1 macro: ' + ((data.f1_macro || 0) * 100).toFixed(2) + '%</p>';
              if (data.per_class) {
                html += '<table style="width:100%;font-size:12px;font-family:monospace;border-collapse:collapse;">';
                html += '<tr><th style="text-align:left;padding:6px;border-bottom:1px solid #2a2e39;">Clase</th><th>Prec</th><th>Recall</th><th>F1</th></tr>';
                ['-1','0','1'].forEach(function(c) {
                  var pc = data.per_class[c];
                  if (pc) {
                    var lbl = c === '1' ? 'Alcista' : c === '-1' ? 'Bajista' : 'Neutral';
                    html += '<tr><td style="padding:6px;border-bottom:1px solid #1e293b;">' + lbl + '</td><td>' + ((pc.precision || 0) * 100).toFixed(1) + '%</td><td>' + ((pc.recall || 0) * 100).toFixed(1) + '%</td><td>' + ((pc.f1 || 0) * 100).toFixed(1) + '%</td></tr>';
                  }
                });
                html += '</table>';
              }
              if (data.confusion_matrix && data.confusion_matrix.length >= 3) {
                var cm = data.confusion_matrix;
                html += '<p style="margin-top:12px;color:#94a3b8;font-size:11px;">Matriz 3×3 (filas=real, cols=pred):</p>';
                html += '<pre style="font-size:11px;margin:4px 0;font-family:monospace;">     -1    0    1\n-1 ' + (cm[0] ? cm[0].join('  ') : '') + '\n 0 ' + (cm[1] ? cm[1].join('  ') : '') + '\n 1 ' + (cm[2] ? cm[2].join('  ') : '') + '</pre>';
              }
              contentEval.innerHTML = html;
            })
            .catch(function(e) {
              contentEval.innerHTML = '<p style="color:#ef5350;">Error: ' + (e.message || String(e)) + '</p>';
            })
            .finally(function() {
              btnEval.disabled = false;
              btnEval.textContent = 'Evaluar modelo';
            });
        });
      }
      if (closeEval && modalEval) {
        closeEval.addEventListener('click', function() { modalEval.classList.add('hidden'); });
      }
      if (modalEval) {
        modalEval.addEventListener('click', function(e) { if (e.target === modalEval) modalEval.classList.add('hidden'); });
      }
      var btnEval = document.getElementById('btnEvaluar');
      var modalEval = document.getElementById('evaluateModal');
      var contentEval = document.getElementById('evaluateContent');
      var closeEval = document.getElementById('evaluateModalClose');
      if (btnEval && modalEval && contentEval) {
        btnEval.addEventListener('click', function() {
          btnEval.disabled = true;
          btnEval.textContent = 'Evaluando…';
          contentEval.innerHTML = '<p style="color:#94a3b8;">Cargando métricas…</p>';
          modalEval.style.display = 'flex';
          modalEval.classList.remove('hidden');
          fetch(apiUrl('/api/evaluate'))
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.error) throw new Error(data.error);
              var html = '<p style="color:#94a3b8;margin-bottom:12px;">Modelo multiclase (-1 Bajista, 0 Neutral, 1 Alcista)</p>';
              html += '<p style="margin-bottom:8px;">Accuracy: ' + ((data.accuracy || 0) * 100).toFixed(2) + '% | F1 macro: ' + ((data.f1_macro || 0) * 100).toFixed(2) + '%</p>';
              if (data.per_class) {
                html += '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
                html += '<tr><th style="text-align:left;padding:6px;border-bottom:1px solid #2a2e39;">Clase</th><th>Prec</th><th>Recall</th><th>F1</th></tr>';
                ['-1','0','1'].forEach(function(c) {
                  var pc = data.per_class[c];
                  if (pc) {
                    var lbl = c === '1' ? 'Alcista' : c === '-1' ? 'Bajista' : 'Neutral';
                    html += '<tr><td style="padding:6px;border-bottom:1px solid #1e293b;">' + lbl + '</td><td>' + ((pc.precision || 0) * 100).toFixed(1) + '%</td><td>' + ((pc.recall || 0) * 100).toFixed(1) + '%</td><td>' + ((pc.f1 || 0) * 100).toFixed(1) + '%</td></tr>';
                  }
                });
                html += '</table>';
              }
              if (data.confusion_matrix && data.confusion_matrix.length >= 3) {
                var cm = data.confusion_matrix;
                html += '<p style="margin-top:12px;color:#94a3b8;font-size:11px;">Matriz 3×3 (filas=real, cols=pred):</p>';
                html += '<pre style="font-size:11px;margin:4px 0;font-family:monospace;">     -1    0    1\n-1 ' + (cm[0] ? cm[0].join('  ') : '') + '\n 0 ' + (cm[1] ? cm[1].join('  ') : '') + '\n 1 ' + (cm[2] ? cm[2].join('  ') : '') + '</pre>';
              }
              contentEval.innerHTML = html;
            })
            .catch(function(err) {
              contentEval.innerHTML = '<p style="color:#ef5350;">Error: ' + (err.message || String(err)) + '</p>';
            })
            .finally(function() {
              btnEval.disabled = false;
              btnEval.textContent = 'Evaluar modelo';
            });
        });
      }
      if (closeEval && modalEval) {
        closeEval.addEventListener('click', function() { modalEval.classList.add('hidden'); });
      }
      if (modalEval) {
        modalEval.addEventListener('click', function(e) { if (e.target === modalEval) modalEval.classList.add('hidden'); });
      }
      fetch(apiUrl('/api/dates'))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var dates = data.dates || [];
          availableDates = dates;
          if (dates.length > 0 && dateInp) {
            dateInp.value = dates[0];
            loadMovers();
          } else if (dateInp && s) {
            dateInp.value = '';
            s.textContent = 'No hay fechas con datos. Ejecuta: npm run sync-mysql';
            s.classList.remove('hidden');
          }
        })
        .catch(function() {
          if (dateInp && s) {
            dateInp.value = '';
            s.textContent = 'No se pudieron cargar fechas. ¿Servidor corriendo? Ejecuta: npm run chart:ui';
            s.classList.remove('hidden');
          }
        });
      if (s) { s.textContent = 'Elige fecha (tickers se cargan solos) → clic en Ticker para elegir → Gráfico.'; s.classList.remove('hidden'); }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }

    let chartInstance = null;

    function fmt(v, d) { return v != null && !isNaN(v) ? Number(v).toFixed(d ?? 2) : '—'; }
    function fmtVol(v) { if (v == null || isNaN(v)) return '—'; return v >= 1e6 ? (v/1e6).toFixed(1) + 'M' : v >= 1e3 ? (v/1e3).toFixed(1) + 'K' : v; }
    function fmtPct(v) { return v != null && !isNaN(v) ? (Number(v) * 100).toFixed(2) + '%' : '—'; }
    function fmtMarketCap(v) { var n = Number(v); if (v == null || v === '' || typeof n !== 'number' || isNaN(n)) return '—'; return (n >= 1 ? n.toFixed(1) : n.toFixed(2)) + 'M'; }

    async function loadChart() {
      const dateEl = document.getElementById('dateSelect');
      const tickerEl = document.getElementById('ticker');
      const ticker = tickerEl && tickerEl.value.trim().toUpperCase();
      const date = dateEl && dateEl.value;
      const resolution = (document.getElementById('resolution') && document.getElementById('resolution').value) || '1m';
      const statusEl = document.getElementById('status');
      const errorEl = document.getElementById('error');
      errorEl.classList.add('hidden');
      document.getElementById('chart-container').classList.add('hidden');
      document.getElementById('chart-summary').classList.add('hidden');
      const tt = document.getElementById('chart-tooltip');
      if (tt) { tt.classList.add('hidden'); tt.innerHTML = ''; }
      document.getElementById('dashboard').classList.add('hidden');
      if (!date) {
        statusEl.textContent = 'Selecciona una fecha.';
        statusEl.classList.remove('hidden');
        return;
      }
      if (!ticker) {
        statusEl.textContent = 'Selecciona un ticker (clic en el campo Ticker para ver el picker).';
        statusEl.classList.remove('hidden');
        return;
      }
      const btn = document.getElementById('btnBuscar');
      if (btn) { btn.disabled = true; btn.textContent = 'Cargando...'; }
      statusEl.textContent = 'Cargando...';
      statusEl.classList.remove('hidden');

      try {
        var url = '/api/ticker/' + encodeURIComponent(ticker) + '?resolution=' + resolution;
        if (date) url += '&date=' + encodeURIComponent(date);
        url = new URL(url, window.location.origin).href;
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error('Servidor respondió ' + res.status + '. ¿Está corriendo npm run ui?');
        }
        const data = await res.json();
        if (!data.rows || data.rows.length === 0) {
          statusEl.classList.add('hidden');
          const hint = ' Ejecuta npm run sync-mysql para cargar datos en MySQL.';
          errorEl.textContent = 'No hay datos para ' + ticker + '.' + hint;
          errorEl.classList.remove('hidden');
          return;
        }
        statusEl.classList.add('hidden');

        const rows = data.rows;
        const resolutionLabel = (data.resolution || resolution) === '5m' ? '5 min' : '1 min';
        const last = rows[rows.length - 1];
        const first = rows[0];
        const openPrice = first.open || first.close;
        const closePrice = last.close;
        const pct = openPrice ? ((closePrice - openPrice) / openPrice * 100) : 0;
        const isUp = pct >= 0;

        document.getElementById('dashboard').classList.remove('hidden');
        document.getElementById('d-ticker').textContent = ticker;
        document.getElementById('d-price').textContent = '$' + fmt(closePrice);
        const chEl = document.getElementById('d-change');
        chEl.textContent = (isUp ? '+' : '') + fmt(pct, 2) + '%';
        chEl.className = 'ticker-change ' + (isUp ? 'up' : 'down');

        const lastVwap = last.vwap ?? rows.filter(r=>r.vwap!=null).pop()?.vwap;
        const lastEma9 = last.ema9 ?? rows.filter(r=>r.ema9!=null).pop()?.ema9;
        const lastEma20 = last.ema20 ?? rows.filter(r=>r.ema20!=null).pop()?.ema20;
        document.getElementById('d-hod').textContent = '$' + fmt(last.high_of_day);
        document.getElementById('d-lod').textContent = '$' + fmt(last.low_of_day);
        document.getElementById('d-vwap').textContent = '$' + fmt(lastVwap);
        document.getElementById('d-ema9').textContent = '$' + fmt(lastEma9);
        document.getElementById('d-ema20').textContent = '$' + fmt(lastEma20);
        document.getElementById('d-atr').textContent = '$' + fmt(last.atr);
        document.getElementById('d-vol').textContent = fmtVol(rows.reduce((s,r)=>s+(r.volume||0),0));
        document.getElementById('d-pmhigh').textContent = '$' + fmt(last.pre_market_high);
        document.getElementById('d-shares').textContent = fmtVol(last.shares_outstanding);
        document.getElementById('d-marketcap').textContent = fmtMarketCap(last.market_cap);

        document.getElementById('chart-summary').textContent = ticker + ' — ' + resolutionLabel + ' (ET) ' + rows.length + ' velas  VWAP ' + fmt(lastVwap) + '  EMA9 ' + fmt(lastEma9) + '  EMA20 ' + fmt(lastEma20);
        document.getElementById('chart-summary').classList.remove('hidden');

        const tooltipPanel = document.getElementById('chart-tooltip');
        if (tooltipPanel) {
          tooltipPanel.innerHTML = '<div class="tt-time" style="color:#64748b">Pasa el cursor sobre el gráfico para ver los datos</div>';
          tooltipPanel.classList.remove('hidden');
        }

        if (chartInstance) chartInstance.remove();
        const container = document.getElementById('chart-container');
        container.innerHTML = '';
        container.classList.remove('hidden');
        container.style.display = 'block';

        if (typeof LightweightCharts === 'undefined') {
          errorEl.textContent = 'Error: LightweightCharts no cargó. Revisa conexión o bloqueadores.';
          errorEl.classList.remove('hidden');
          return;
        }

        requestAnimationFrame(() => {
        const chart = LightweightCharts.createChart(container, {
          layout: { background: { color: '#131820' }, textColor: '#94a3b8', fontFamily: '"JetBrains Mono", monospace', fontSize: 11 },
          grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
          width: container.clientWidth,
          height: 480,
          timeScale: {
            timeVisible: true,
            secondsVisible: false,
            borderColor: '#2a2e39',
            tickMarkFormatter: (time) => {
              let ts = typeof time === 'number' ? time : (typeof time === 'string' ? new Date(time).getTime()/1000 : 0);
              if (ts > 1e12) ts = ts / 1000;
              const d = new Date(ts * 1000);
              if (isNaN(d.getTime())) return '--';
              const s = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
              return s === 'Invalid Date' ? '--' : s;
            },
          },
          rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: 0.05, bottom: 0.2 } },
          crosshair: { mode: 0 },
          localization: {
            timeFormatter: (ts) => { var d=new Date(ts*1000); return isNaN(d.getTime())?'--':d.toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false}); },
            dateFormatter: (ts) => { var d=new Date(ts*1000); return isNaN(d.getTime())?'--':d.toLocaleDateString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric'}); },
          },
        });

        const candlestickSeries = chart.addCandlestickSeries({
          upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
          wickUpColor: '#26a69a', wickDownColor: '#ef5350',
        });

        const vwapSeries = chart.addLineSeries({
          color: '#facc15', lineWidth: 2, title: 'VWAP',
          lastValueVisible: true, priceLineVisible: true,
        });
        const ema9Series = chart.addLineSeries({
          color: '#38bdf8', lineWidth: 1, title: 'EMA9',
          lastValueVisible: true, priceLineVisible: false,
        });
        const ema20Series = chart.addLineSeries({
          color: '#a78bfa', lineWidth: 1, title: 'EMA20',
          lastValueVisible: true, priceLineVisible: false,
        });

        const candleData = [];
        const vwapData = [];
        const ema9Data = [];
        const ema20Data = [];
        const volData = [];

        function parseETToUnix(dateStr, timeStr) {
          var dStr = dateStr;
          if (dStr instanceof Date) {
            var y = dStr.getFullYear(), mo = dStr.getMonth() + 1, da = dStr.getDate();
            dStr = y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0');
          } else if (typeof dStr !== 'string') {
            dStr = String(dStr || '');
          }
          var match = dStr.match(/^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})/);
          if (!match) return 0;
          var y = parseInt(match[1], 10), mo = parseInt(match[2], 10), da = parseInt(match[3], 10);
          var datePart = match[1] + '-' + match[2] + '-' + match[3];
          const pad = (n) => String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, '0');
          const [h, m] = String(timeStr || '00:00').split(':').map((x) => parseInt(x, 10));
          const hour = pad(isNaN(h) ? 0 : h);
          const min = pad(isNaN(m) ? 0 : m);
          const isEDT = (mo > 3 && mo < 11) || (mo === 3 && da >= 8) || (mo === 11 && da < 7);
          const offset = isEDT ? '-04:00' : '-05:00';
          var ts = Math.floor(new Date(datePart + 'T' + hour + ':' + min + ':00' + offset).getTime() / 1000);
          return isNaN(ts) || ts <= 0 ? 0 : ts;
        }
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const t = parseETToUnix(r.date, r.candle_time_et);
          if (t <= 0 || isNaN(t)) continue;
          candleData.push({ time: t, open: r.open, high: r.high, low: r.low, close: r.close });
          if (r.vwap != null && !isNaN(r.vwap)) vwapData.push({ time: t, value: r.vwap });
          if (r.ema9 != null && !isNaN(r.ema9)) ema9Data.push({ time: t, value: r.ema9 });
          if (r.ema20 != null && !isNaN(r.ema20)) ema20Data.push({ time: t, value: r.ema20 });
          volData.push({ time: t, value: r.volume || 0, color: (r.close >= (r.open||r.close)) ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)' });
        }

        candlestickSeries.setData(candleData);
        if (vwapData.length) vwapSeries.setData(vwapData);
        if (ema9Data.length) ema9Series.setData(ema9Data);
        if (ema20Data.length) ema20Series.setData(ema20Data);

        const volSeries = chart.addHistogramSeries({
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        volSeries.setData(volData);

        chart.timeScale().fitContent();
        if (candleData.length > 0) {
          try {
            chart.timeScale().setVisibleLogicalRange({ from: 0, to: Math.max(0, candleData.length - 1) });
          } catch (_) {}
        }
        chartInstance = chart;

        const tooltipEl = document.getElementById('chart-tooltip-floating');
        const tooltipFloating = document.getElementById('chart-tooltip-floating');
        const tooltipDisplay = tooltipFloating || tooltipEl;
        if (tooltipEl) tooltipEl.classList.add('hidden');
        if (tooltipFloating) { tooltipFloating.innerHTML = ''; tooltipFloating.classList.add('hidden'); }

        const rowsByTime = {};
        for (let i = 0; i < rows.length; i++) {
          const t = parseETToUnix(rows[i].date, rows[i].candle_time_et);
          rowsByTime[t] = rows[i];
        }
        const placeholder = '<span style="color:#64748b">Pasa el cursor sobre una vela → clic para fijar y poder usar Evaluar</span>';
        var tooltipPinned = false;
        var pinnedRow = null;
        var lastTooltipRow = null;

        function buildTooltipHtml(row) {
          var html = '<div class="tt-time">' + (row.date || '') + ' ' + (row.candle_time_et || '') + ' ET</div>';
          html += '<div style="margin-bottom:6px;color:#facc15;font-size:11px;font-weight:600">Labels</div>';
          html += '<div class="tt-row"><span class="tt-label">ret 5m</span><span class="tt-value">' + fmtPct(row.future_return_5m) + '</span></div>';
          var tgtVal = Number(row.target);
          html += '<div class="tt-row"><span class="tt-label">target</span><span class="tt-value">' + (tgtVal === 1 ? 'Alcista' : tgtVal === -1 ? 'Bajista' : tgtVal === 0 ? 'Neutral' : '—') + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">break HOD 5m</span><span class="tt-value">' + (Number(row.target_break_hod_5m) === 1 ? 'Sí' : (Number(row.target_break_hod_5m) === 0 ? 'No' : '—')) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">max ret 10m</span><span class="tt-value">' + fmtPct(row.max_future_return_10m) + '</span></div>';
          html += '<div style="margin-top:8px;margin-bottom:4px;color:#94a3b8;font-size:10px">OHLC</div>';
          html += '<div class="tt-row"><span class="tt-label">O</span><span class="tt-value">$' + fmt(row.open) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">H</span><span class="tt-value">$' + fmt(row.high) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">L</span><span class="tt-value">$' + fmt(row.low) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">C</span><span class="tt-value">$' + fmt(row.close) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">Vol</span><span class="tt-value">' + fmtVol(row.volume) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">ATR</span><span class="tt-value">$' + fmt(row.atr) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">VWAP</span><span class="tt-value">$' + fmt(row.vwap) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">EMA9</span><span class="tt-value">$' + fmt(row.ema9) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">EMA20</span><span class="tt-value">$' + fmt(row.ema20) + '</span></div>';
          html += '<div style="margin-top:8px;margin-bottom:4px;color:#94a3b8;font-size:10px">General</div>';
          html += '<div class="tt-row"><span class="tt-label">Shares</span><span class="tt-value">' + fmtVol(row.shares_outstanding) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">Mkt Cap</span><span class="tt-value">' + fmtMarketCap(row.market_cap) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">Gap %</span><span class="tt-value">' + fmtPct(row.gap_pct) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">PM Vol</span><span class="tt-value">' + fmtVol(row.premarket_volume) + '</span></div>';
          html += '<div style="margin-top:8px;margin-bottom:4px;color:#38bdf8;font-size:10px">Features</div>';
          html += '<div class="tt-row"><span class="tt-label">mom</span><span class="tt-value">' + fmtPct(row.momentum_acumulado) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">ch 1m</span><span class="tt-value">' + fmtPct(row.change_1m) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">ch 5m</span><span class="tt-value">' + fmtPct(row.change_5m) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">ch 10m</span><span class="tt-value">' + fmtPct(row.change_10m) + '</span></div>';
          html += '<div class="tt-row"><span class="tt-label">min HOD</span><span class="tt-value">' + (row.minutes_since_hod != null && !isNaN(row.minutes_since_hod) ? row.minutes_since_hod : '—') + '</span></div>';
          if (resolutionLabel === '5 min') {
            html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #2a2e39;font-size:10px;color:#f59e0b;">El modelo fue entrenado con datos de 1 min. Cambia a resolución 1 min para evaluar velas.</div>';
          } else {
            html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid #2a2e39;"><span style="font-size:10px;color:#64748b;margin-right:6px;">Umbral:</span><select id="evalThresholdSelect" style="font-size:10px;padding:2px 6px;background:#1e293b;border:1px solid #334155;border-radius:4px;color:#94a3b8;margin-right:8px;"><option value="0.5">50%</option><option value="0.55">55%</option><option value="0.6" selected>60%</option><option value="0.65">65%</option><option value="0.7">70%</option><option value="0.75">75%</option><option value="0.8">80%</option></select><button type="button" id="btnEvalCandle" style="padding:4px 12px;font-size:11px;background:#7c3aed;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600;">Evaluar</button><span id="evalResult" style="margin-left:8px;font-size:11px;"></span></div>';
          }
          html += '<div style="margin-top:6px;font-size:10px;color:#64748b;">Clic fuera o Esc para cerrar</div>';
          return html;
        }
        function getFeaturesFromRow(row) {
          var keys = ['candle_idx','open','high','low','close','volume','atr','vwap','high_of_day','low_of_day','change_pct_at_candle','ema9','ema20','pre_market_high','shares_outstanding','market_cap','gap_pct','premarket_volume','momentum_acumulado','change_1m','change_5m','change_10m','minutes_since_hod','volume_rel','dist_vwap_pct','atr_rel','volume_pm_ratio','minute_of_day','fraction_of_day','macd','macd_signal','macd_hist','rsi','bb_position','stoch_k','stoch_d','cci_20','return_lag_1','return_lag_2','return_lag_3','return_lag_5','return_lag_10','return_lag_20','volatility_15m','mom_5','mom_10','return_1m_lag1','return_1m_lag2'];
          var o = {};
          keys.forEach(function(k) { o[k] = row[k] != null && !isNaN(row[k]) ? Number(row[k]) : 0; });
          return o;
        }
        function doEvalCandle(row) {
          var btn = document.getElementById('btnEvalCandle');
          var span = document.getElementById('evalResult');
          if (!btn || !span) return;
          btn.disabled = true;
          span.textContent = '…';
          var features = getFeaturesFromRow(row);
          var sel = document.getElementById('evalThresholdSelect');
          fetch(apiUrl('/api/predict'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(features) })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.error) { span.textContent = 'Error'; span.style.color = '#ef5350'; return; }
              var pred = data.predicted_class;
              var label = pred === 1 ? 'Alcista' : pred === -1 ? 'Bajista' : 'Neutral';
              var prob1 = (data.proba && data.proba[1]) ? (data.proba[1] * 100).toFixed(1) : '—';
              span.textContent = label + ' (P(alcista) ' + prob1 + '%)';
              span.style.color = pred === 1 ? '#22c55e' : pred === -1 ? '#ef5350' : '#94a3b8';
            })
            .catch(function() { span.textContent = 'Error'; span.style.color = '#ef5350'; })
            .finally(function() { if (btn) btn.disabled = false; });
        }

        function updateTooltipFromTime(t) {
          if (!tooltipEl || !t) return;
          let row = rowsByTime[t];
          if (!row) row = rows.find(function(r) {
            const rt = parseETToUnix(r.date, r.candle_time_et);
            const tol = resolutionLabel === '5 min' ? 300 : 120;
            return Math.abs(rt - t) <= tol;
          });
          if (!row) { tooltipEl.innerHTML = placeholder; return; }
          lastTooltipRow = row;
          tooltipEl.innerHTML = buildTooltipHtml(row);
        }

        chart.subscribeCrosshairMove(function(param) {
          if (!tooltipEl || tooltipPinned) return;
          if (!param || param.time === undefined || param.time === null) {
            tooltipEl.innerHTML = placeholder;
            return;
          }
          const t = typeof param.time === 'string' ? Math.floor(new Date(param.time).getTime() / 1000) : Math.floor(Number(param.time));
          let row = rowsByTime[t];
          if (!row) {
            row = rows.find(function(r) {
              const rt = parseETToUnix(r.date, r.candle_time_et);
              const tol = resolutionLabel === '5 min' ? 300 : 120;
              return Math.abs(rt - t) <= tol;
            });
          }
          if (!row) { tooltipEl.innerHTML = placeholder; return; }
          lastTooltipRow = row;
          tooltipEl.innerHTML = buildTooltipHtml(row);
          tooltipEl.classList.remove('hidden');
        });

        container.addEventListener('mousemove', function(e) {
          if (!tooltipEl) return;
          if (tooltipPinned) return;
          tooltipEl.style.left = (e.clientX + 16) + 'px';
          tooltipEl.style.top = (e.clientY + 16) + 'px';
          const rect = container.getBoundingClientRect();
          const x = e.clientX - rect.left;
          try {
            const time = chart.timeScale().coordinateToTime(x);
            if (time != null) {
              const t = typeof time === 'string' ? Math.floor(new Date(time).getTime() / 1000) : Math.floor(Number(time));
              updateTooltipFromTime(t);
              tooltipEl.style.left = (e.clientX + 15) + 'px';
              tooltipEl.style.top = (e.clientY + 15) + 'px';
              tooltipEl.classList.remove('hidden');
            }
          } catch (_) {}
        });
        container.addEventListener('mouseleave', function() {
          if (tooltipPinned) return;
          if (tooltipEl) { tooltipEl.classList.add('hidden'); tooltipEl.innerHTML = placeholder; }
        });
        container.addEventListener('click', function(e) {
          if (e.target.closest && e.target.closest('#chart-tooltip-floating')) return;
          if (tooltipPinned) {
            tooltipPinned = false;
            pinnedRow = null;
            if (tooltipEl) { tooltipEl.classList.add('hidden'); tooltipEl.style.pointerEvents = 'none'; tooltipEl.innerHTML = placeholder; }
            return;
          }
          if (!lastTooltipRow || !tooltipEl) return;
          const rect = container.getBoundingClientRect();
          const x = e.clientX - rect.left;
          try {
            const time = chart.timeScale().coordinateToTime(x);
            if (time == null) return;
            const t = typeof time === 'string' ? Math.floor(new Date(time).getTime() / 1000) : Math.floor(Number(time));
            let row = rowsByTime[t];
            if (!row) row = rows.find(function(r) {
              const rt = parseETToUnix(r.date, r.candle_time_et);
              const tol = resolutionLabel === '5 min' ? 300 : 120;
              return Math.abs(rt - t) <= tol;
            });
            if (!row) return;
            tooltipPinned = true;
            pinnedRow = row;
            lastTooltipRow = row;
            tooltipEl.innerHTML = buildTooltipHtml(row);
            tooltipEl.style.left = (e.clientX + 15) + 'px';
            tooltipEl.style.top = (e.clientY + 15) + 'px';
            tooltipEl.style.pointerEvents = 'auto';
            tooltipEl.classList.remove('hidden');
          } catch (_) {}
        });
        if (tooltipEl) {
          tooltipEl.addEventListener('click', function(e) {
            if (e.target.id === 'btnEvalCandle' && lastTooltipRow) doEvalCandle(lastTooltipRow);
          });
        }
        document.addEventListener('keydown', function(e) {
          if (e.key === 'Escape' && tooltipPinned) {
            tooltipPinned = false;
            pinnedRow = null;
            if (tooltipEl) { tooltipEl.classList.add('hidden'); tooltipEl.style.pointerEvents = 'none'; tooltipEl.innerHTML = placeholder; }
          }
        });

        window.addEventListener('resize', () => chart.applyOptions({ width: container.clientWidth }));
        });
      } catch (e) {
        statusEl.classList.add('hidden');
        const msg = (e && e.message === 'Failed to fetch')
          ? 'No se pudo conectar. ¿Está corriendo el servidor? Ejecuta en stock-training: npm run ui'
          : 'Error: ' + (e && e.message ? e.message : String(e));
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
      } finally {
        const btn = document.getElementById('btnBuscar');
        if (btn) { btn.disabled = false; btn.textContent = 'Buscar'; }
      }
    }
  </script>
  <script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js?v=2" async></script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const fullUrl = req.url ?? '';
  const q = fullUrl.includes('?') ? new URLSearchParams(fullUrl.split('?')[1]) : null;

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
    });
    res.end(INDEX_HTML);
    return;
  }

  if (url === '/api/dates') {
    try {
      const dates = await getDates();
      if (!dates || dates.length === 0) {
        console.warn('[API] /api/dates: sin fechas. ¿MySQL conectado? ¿Tabla training_1m con datos? Ejecuta: npm run sync-mysql');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ dates: dates || [] }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (url === '/api/top-movers') {
    const date = q?.get('date') || '';
    console.log('[API] GET /api/top-movers date=' + date);
    if (!date) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'date required' }));
      return;
    }
    try {
      const movers = await getTopMovers(date);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ date, movers }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  const match = url.match(/^\/api\/ticker\/([A-Za-z0-9.]+)$/);
  if (match) {
    const ticker = match[1];
    const resolution: Resolution = (q?.get('resolution') === '5m' ? '5m' : '1m');
    const date = q?.get('date') || '';
    const rows = date ? await getTickerData(ticker, date, resolution) : [];
    console.log('[API] GET /api/ticker/' + ticker + ' date=' + date + ' resolution=' + resolution + ' rows=' + rows.length);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ticker, date: date || null, resolution, rows }));
    return;
  }

  if (url === '/api/evaluate') {
    const mlDir = path.join(__dirname, '..', 'ml');
    console.log('[API] GET /api/evaluate');
    return new Promise<void>((resolve) => {
      const proc = spawn('python3', ['-m', 'xgb.evaluate', '--json'], {
        cwd: mlDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.on('close', (code) => {
        if (code !== 0) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: stderr || 'Evaluate failed' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(stdout);
        }
        resolve();
      });
    });
  }

  if (url === '/api/predict' || url === '/api/predict/') {
    console.log('[API]', req.method, url);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return;
    }
    const mlDir = path.join(__dirname, '..', 'ml');
    return new Promise<void>((resolve) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          if (typeof payload._threshold !== 'number') payload._threshold = 0.6;
          const input = JSON.stringify(payload);
          const proc = spawn('python3', ['-m', 'xgb.predict'], {
            cwd: mlDir,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          let stdout = '';
          let stderr = '';
          proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
          proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
          proc.stdin.write(input, () => proc.stdin.end());
          proc.on('close', (code) => {
            if (code !== 0) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: stderr || 'Predict failed' }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(stdout);
            }
            resolve();
          });
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (e as Error).message || 'Invalid JSON' }));
          resolve();
        }
      });
    });
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Chart UI: http://localhost:${PORT}`);
  console.log('Escribe un ticker y pulsa Buscar.');
});

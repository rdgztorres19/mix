import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScreenerStore, FILTER_PRESETS, type ScreenerFilters, type SortField } from '@/stores/screener.store';
import { Card, CardHeader, CardTitle, CardToolbar, CardTable } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, X, Filter, SlidersHorizontal, ArrowUp, ArrowDown } from 'lucide-react';

const FILTER_LABELS: Record<keyof ScreenerFilters, string> = {
  priceMin: 'Price Min',
  priceMax: 'Price Max',
  gapPctMin: 'Gap %',
  volumeMin: 'Volume',
  changePctMin: 'Change %',
};

function formatFilterValue(key: keyof ScreenerFilters, val: number): string {
  if (key === 'volumeMin') {
    if (val >= 1_000_000) return `>= ${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `>= ${(val / 1_000).toFixed(0)}K`;
  }
  if (key === 'gapPctMin' || key === 'changePctMin') return `>= ${val}%`;
  if (key === 'priceMin') return `>= $${val}`;
  if (key === 'priceMax') return `<= $${val}`;
  return String(val);
}

export function ScreenerPage() {
  const store = useScreenerStore();
  const { date, results, filters, activePreset, sortField, sortOrder, loading, error } = store;
  const navigate = useNavigate();

  useEffect(() => { store.init(); }, []);
  useEffect(() => { if (date) store.fetchResults(); }, [date]);

  const [search, setSearch] = useState('');
  const filtered = store.getFilteredResults().filter(
    (s) => !search || s.symbol.toUpperCase().includes(search.toUpperCase()),
  );

  const activeFilters = (Object.entries(filters) as [keyof ScreenerFilters, number | null][])
    .filter(([_, v]) => v != null)
    .map(([key, val]) => ({ key, val: val! }));

  return (
    <div className="container-fluid">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-semibold">Daily Screener</h1>
        <Badge variant="warning" appearance="light" size="sm">Historical Mode</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stocks in Play</CardTitle>
          <CardToolbar>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search symbol..."
                  className="bg-background border border-input shadow-xs rounded-md h-8.5 pl-8 pr-3 w-[160px] text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
                />
              </div>
              <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && store.setDate(e.target.value)}
                min="2023-01-02"
                max="2026-03-27"
                className="bg-background border border-input shadow-xs rounded-md h-8.5 px-3 text-sm text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
              />
            </div>
          </CardToolbar>
        </CardHeader>

        {/* ── Filter Bar ── */}
        <div className="px-5 py-3 border-b border-border">
          {/* Row 1: Preset + filter inputs */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <SlidersHorizontal className="size-3.5 text-muted-foreground shrink-0" />
            <Select value={activePreset} onValueChange={(v) => store.applyPreset(v)}>
              <SelectTrigger className="w-[170px]" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTER_PRESETS.map((p) => (
                  <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                ))}
                {activePreset === 'Custom' && <SelectItem value="Custom">Custom</SelectItem>}
              </SelectContent>
            </Select>

            <Separator orientation="vertical" className="h-5" />

            <FilterInput label="Price" minVal={filters.priceMin} maxVal={filters.priceMax}
              onMinChange={(v) => store.setFilter('priceMin', v)}
              onMaxChange={(v) => store.setFilter('priceMax', v)} />
            <FilterNum label="Gap %" value={filters.gapPctMin}
              onChange={(v) => store.setFilter('gapPctMin', v)} />
            <FilterNum label="Vol" value={filters.volumeMin}
              onChange={(v) => store.setFilter('volumeMin', v)} step={100000} />
            <FilterNum label="Chg %" value={filters.changePctMin}
              onChange={(v) => store.setFilter('changePctMin', v)} />

            <div className="ml-auto">
              <Badge variant="secondary" appearance="light" size="sm">
                {filtered.length} of {results.length}
              </Badge>
            </div>
          </div>

          {/* Row 2: Active chips */}
          {activeFilters.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {activeFilters.map(({ key, val }) => (
                <Badge key={key} variant="secondary" size="sm" className="gap-1 pe-1">
                  {FILTER_LABELS[key]}: {formatFilterValue(key, val)}
                  <button onClick={() => store.setFilter(key, null)} className="ms-0.5 hover:text-foreground transition-colors">
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              <Button variant="ghost" size="sm" onClick={store.clearFilters} className="text-xs text-muted-foreground h-6">
                Clear all
              </Button>
            </div>
          )}
        </div>

        {/* ── Table ── */}
        <CardTable>
          {loading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-32 text-destructive text-sm">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <Filter className="size-5 opacity-50" />
              <span className="text-sm">
                {results.length === 0
                  ? (date ? `No data synced for ${date}` : 'Pick a date to see stocks in play')
                  : `No stocks match current filters (${results.length} total)`}
              </span>
              {results.length > 0 && (
                <Button variant="outline" size="sm" onClick={store.clearFilters}>Clear filters</Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Symbol</TableHead>
                  <SortableHead field="gapPct" label="Gap %" sortField={sortField} sortOrder={sortOrder} onSort={store.setSort} />
                  <SortableHead field="changePct" label="Change %" sortField={sortField} sortOrder={sortOrder} onSort={store.setSort} />
                  <SortableHead field="hodPct" label="HOD %" sortField={sortField} sortOrder={sortOrder} onSort={store.setSort} />
                  <SortableHead field="morningPct" label="9-11:30 %" sortField={sortField} sortOrder={sortOrder} onSort={store.setSort} />
                  <SortableHead field="volume" label="Volume" sortField={sortField} sortOrder={sortOrder} onSort={store.setSort} />
                  <TableHead className="text-right">Prev Close</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <SortableHead field="close" label="Close" sortField={sortField} sortOrder={sortOrder} onSort={store.setSort} />
                  <TableHead className="text-right">High</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row, idx) => {
                  const hodPct = row.previousClose > 0 ? ((row.high - row.previousClose) / row.previousClose) * 100 : 0;
                  return (
                    <TableRow key={row.symbol} className="cursor-pointer"
                      onClick={() => navigate(`/chart/${row.symbol}/${date}`)}>
                      <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-semibold">{row.symbol}</TableCell>
                      <TableCell className="text-right font-mono">
                        <span className={row.gapPct >= 0 ? 'text-green-500' : 'text-red-500'}>
                          {row.gapPct >= 0 ? '+' : ''}{row.gapPct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className={row.changePct >= 0 ? 'text-green-500' : 'text-red-500'}>
                          {row.changePct >= 0 ? '+' : ''}{row.changePct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className={hodPct >= 0 ? 'text-green-500' : 'text-red-500'}>
                          {hodPct >= 0 ? '+' : ''}{hodPct.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <span className={(row.morningPct ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}>
                          {(row.morningPct ?? 0) >= 0 ? '+' : ''}{(row.morningPct ?? 0).toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{formatVolume(row.volume)}</TableCell>
                      <TableCell className="text-right font-mono">${row.previousClose.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">${row.open.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">${row.close.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-mono">${row.high.toFixed(2)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardTable>
      </Card>
    </div>
  );
}

// ── Filter Components ──

function FilterInput({ label, minVal, maxVal, onMinChange, onMaxChange }: {
  label: string; minVal: number | null; maxVal: number | null;
  onMinChange: (v: number | null) => void; onMaxChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-muted-foreground font-medium shrink-0">{label}</span>
      <input type="number" value={minVal ?? ''} placeholder="min"
        onChange={(e) => onMinChange(e.target.value ? Number(e.target.value) : null)}
        className="w-14 bg-background border border-input rounded-md h-7 px-1.5 text-xs text-foreground text-center focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/20" />
      <span className="text-muted-foreground text-[10px]">-</span>
      <input type="number" value={maxVal ?? ''} placeholder="max"
        onChange={(e) => onMaxChange(e.target.value ? Number(e.target.value) : null)}
        className="w-14 bg-background border border-input rounded-md h-7 px-1.5 text-xs text-foreground text-center focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/20" />
    </div>
  );
}

function FilterNum({ label, value, onChange, step = 1 }: {
  label: string; value: number | null; onChange: (v: number | null) => void; step?: number;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[11px] text-muted-foreground font-medium shrink-0">{label}</span>
      <input type="number" value={value ?? ''} step={step} placeholder="min"
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-16 bg-background border border-input rounded-md h-7 px-1.5 text-xs text-foreground text-center focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[2px] focus-visible:ring-ring/20" />
    </div>
  );
}

function SortableHead({ field, label, sortField, sortOrder, onSort }: {
  field: SortField; label: string; sortField: SortField; sortOrder: string;
  onSort: (f: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <TableHead className="text-right">
      <button
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 cursor-pointer transition-colors ${active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        {label}
        {active && (sortOrder === 'desc'
          ? <ArrowDown className="size-3" />
          : <ArrowUp className="size-3" />
        )}
      </button>
    </TableHead>
  );
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

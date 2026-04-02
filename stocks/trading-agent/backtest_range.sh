#!/usr/bin/env bash
# backtest_range.sh — Run LSTM backtest over a date range, show only summaries + aggregate
#
# Usage:
#   ./backtest_range.sh START_DATE END_DATE START_TIME END_TIME THRESHOLD TP SL [--lgbm]
#
# Example:
#   ./backtest_range.sh 2026-03-17 2026-03-27 09:30 11:00 0.70 4 2
#   ./backtest_range.sh 2026-03-17 2026-03-27 09:30 11:00 0.65 4 2 --lgbm

set -euo pipefail

START_DATE="${1:?Usage: $0 START END START_TIME END_TIME THRESHOLD TP SL}"
END_DATE="${2:?}"
START_TIME="${3:?}"
END_TIME="${4:?}"
THRESHOLD="${5:?}"
TP="${6:?}"
SL="${7:?}"
MODE="${8:-lstm}"
SEQ_MODEL="${9:-lstm}"  # lstm | gru | transformer (only applies when not --lgbm)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ "$MODE" == "--lgbm" ]]; then
  RUNNER="src/scripts/backtest-simulator/main.ts"
  SEQ_MODEL_ARG=""
else
  RUNNER="src/scripts/backtest-simulator/main-lstm.ts"
  SEQ_MODEL_ARG="$SEQ_MODEL"
fi

total_signals=0
total_wins=0
total_losses=0
total_neutral=0
days_run=0

# Convert dates to epoch seconds for comparison (macOS compatible)
end_ts=$(date -j -f "%Y-%m-%d" "$END_DATE" "+%s")
current="$START_DATE"

while true; do
  cur_ts=$(date -j -f "%Y-%m-%d" "$current" "+%s")
  [[ $cur_ts -gt $end_ts ]] && break

  # Skip weekends (1=Mon ... 7=Sun)
  dow=$(date -j -f "%Y-%m-%d" "$current" "+%u")
  if [[ "$dow" -ge 6 ]]; then
    current=$(date -j -v+1d -f "%Y-%m-%d" "$current" "+%Y-%m-%d")
    continue
  fi

  # Run backtest, capture output, filter to summary only (stop before Per-Symbol)
  output=$(cd "$SCRIPT_DIR" && npx ts-node $RUNNER "$current" "$START_TIME" "$END_TIME" "$THRESHOLD" "$TP" "$SL" $SEQ_MODEL_ARG 2>/dev/null \
    | awk '/BACKTEST SUMMARY/{found=1} /Per-Symbol Breakdown/{found=0} found && !/^\+[-+]+\+/ && !/^\| Symbol/' \
    | sed '/^[[:space:]]*$/d' || true)

  if [[ -n "$output" ]]; then
    echo "$output"
    echo ""

    # Parse data row (│ signals │ wins │ losses │ neutral │ ... )
    row=$(echo "$output" | grep "│" | grep -v "Signals\|═\|─\|┌\|└\|├" | head -1)
    if [[ -n "$row" ]]; then
      sig=$(echo "$row" | awk -F'│' '{gsub(/ /,"",$2); print $2}')
      win=$(echo "$row" | awk -F'│' '{gsub(/ /,"",$3); print $3}')
      loss=$(echo "$row" | awk -F'│' '{gsub(/ /,"",$4); print $4}')
      neu=$(echo "$row" | awk -F'│' '{gsub(/ /,"",$5); print $5}')

      [[ "$sig" =~ ^[0-9]+$ ]] && total_signals=$((total_signals + sig))
      [[ "$win" =~ ^[0-9]+$ ]] && total_wins=$((total_wins + win))
      [[ "$loss" =~ ^[0-9]+$ ]] && total_losses=$((total_losses + loss))
      [[ "$neu" =~ ^[0-9]+$ ]] && total_neutral=$((total_neutral + neu))
      days_run=$((days_run + 1))
    fi
  fi

  current=$(date -j -v+1d -f "%Y-%m-%d" "$current" "+%Y-%m-%d")
done

# Aggregate summary
echo "══════════════════════════════════════════════════════════════════════════"
echo "  AGGREGATE  |  $START_DATE → $END_DATE  |  Thr: $THRESHOLD  TP: ${TP}%  SL: ${SL}%  |  $days_run days"
echo "══════════════════════════════════════════════════════════════════════════"

if [[ $total_signals -gt 0 ]]; then
  wr=$(awk "BEGIN {printf \"%.1f\", ($total_wins/$total_signals)*100}")
  avg_pnl=$(awk "BEGIN {printf \"%.2f\", (($total_wins * $TP) - ($total_losses * $SL)) / $total_signals}")
  echo "  Signals: $total_signals  |  Wins: $total_wins  |  Losses: $total_losses  |  Neutral: $total_neutral"
  echo "  Win Rate: ${wr}%  |  Avg PnL: +${avg_pnl}%"
else
  echo "  No signals fired across date range."
fi
echo "══════════════════════════════════════════════════════════════════════════"

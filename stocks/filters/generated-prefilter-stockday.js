function passesGeneratedPreFilter(row) {
  return (
    (Number.isFinite(row.premarket_dollar_volume) && row.premarket_dollar_volume <= 407568.983475) &&
    (String(row.close_gt_ema9) === "1")
  );
}

module.exports = { passesGeneratedPreFilter };
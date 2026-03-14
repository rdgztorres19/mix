function passesGeneratedPreFilter(row) {
  return (
    (Number.isFinite(row.premarket_dollar_volume) && row.premarket_dollar_volume <= 398901.747075) &&
    (Number.isFinite(row.distance_to_pm_high_pct) && row.distance_to_pm_high_pct <= 0.1515296488)
  );
}

module.exports = { passesGeneratedPreFilter };
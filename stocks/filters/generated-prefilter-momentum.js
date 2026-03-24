function passesGeneratedMomentumPreFilter(row) {
  return (
    (Number.isFinite(row.pm_range_pct) && row.pm_range_pct <= 0.1723371648) &&
    (Number.isFinite(row.distance_to_pm_high_pct) && row.distance_to_pm_high_pct <= 0.1434230295) &&
    (Number.isFinite(row.pm_close_vs_high_pct) && row.pm_close_vs_high_pct >= -0.1251917404)
  );
}

module.exports = { passesGeneratedMomentumPreFilter };
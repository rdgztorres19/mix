function passesGeneratedPreFilter(row) {
  return (
    (Number.isFinite(row.distance_to_pm_high_pct) && row.distance_to_pm_high_pct <= 0.0425076136) &&
    (Number.isFinite(row.change_5m) && row.change_5m <= -0.0237284483)
  );
}

module.exports = { passesGeneratedPreFilter };
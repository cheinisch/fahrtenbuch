/**
 * Fahrten, die zu den Kilometern eines Benutzers zählen: die eigenen sowie die anderer
 * Fahrer mit seinem Fahrzeug während eines Besitzzeitraums (vehicle_ownership_periods).
 */
export function vehicleTripScopeSql(alias, userParameter) {
  return `(${alias}.user_id = ${userParameter} OR EXISTS (
    SELECT 1 FROM vehicle_ownership_periods p
    WHERE p.vehicle_id = ${alias}.vehicle_id AND p.user_id = ${userParameter}
      AND ${alias}.started_at >= p.valid_from
      AND (p.valid_to IS NULL OR ${alias}.started_at < p.valid_to)
  ))`;
}

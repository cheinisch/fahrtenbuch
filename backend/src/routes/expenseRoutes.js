import { Router } from "express";

import { pool } from "../database/pool.js";
import { badRequest, notFound } from "../lib/errors.js";
import { tripLocalStartSql, userTimeZone } from "../lib/timezone.js";
import {
  booleanField,
  dateQuery,
  enumField,
  numberField,
  objectBody,
  stringField,
  uuidValue,
} from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";

// Fahrzeugkosten: Tanken/Laden und sonstige Kosten.
// Zunächst nur für den Fahrzeughalter – Kosten geteilter Fahrzeuge bleiben privat.

export const expenseRoutes = Router();
expenseRoutes.use(requireAuth);

export const EXPENSE_CATEGORIES = Object.freeze([
  "fuel", "charging", "insurance", "tax", "maintenance", "repair", "tires",
  "leasing", "financing", "parking", "toll", "cleaning", "inspection", "other",
]);
const ENERGY_CATEGORIES = new Set(["fuel", "charging"]);
const QUANTITY_UNITS = ["l", "kwh", "kg"];
const FUEL_TYPES = ["petrol", "diesel", "lpg", "cng", "electric", "hydrogen", "other"];

const EXPENSE_SELECT = `
  SELECT e.id, e.vehicle_id, v.name AS vehicle_name, e.category,
         to_char(e.expense_date, 'YYYY-MM-DD') AS expense_date,
         e.amount_cents, e.currency, e.odometer_meters, e.quantity, e.quantity_unit,
         e.fuel_type, e.full_tank,
         to_char(e.period_start, 'YYYY-MM-DD') AS period_start,
         to_char(e.period_end, 'YYYY-MM-DD') AS period_end,
         e.trip_id, e.vendor, e.notes, e.created_at, e.updated_at
    FROM vehicle_expenses e
    JOIN vehicles v ON v.id = e.vehicle_id
`;

function centsToAmount(cents) {
  return Math.round(Number(cents)) / 100;
}

function mapExpense(row) {
  const quantity = row.quantity == null ? null : Number(row.quantity);
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    vehicleName: row.vehicle_name,
    category: row.category,
    date: row.expense_date,
    amount: centsToAmount(row.amount_cents),
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    odometerKm: row.odometer_meters == null ? null : Number(row.odometer_meters) / 1000,
    quantity,
    quantityUnit: row.quantity_unit,
    // Preis je Liter/kWh, auf zehntel Cent wie an der Tankstelle
    pricePerUnit: quantity ? Math.round((Number(row.amount_cents) / 100 / quantity) * 1000) / 1000 : null,
    fuelType: row.fuel_type,
    fullTank: Boolean(row.full_tank),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    tripId: row.trip_id,
    vendor: row.vendor,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dateField(object, name, { required = false, nullable = false } = {}) {
  const value = object?.[name];
  if (value === undefined) {
    if (required) throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ ist erforderlich.`);
    return undefined;
  }
  if (value === null || value === "") {
    if (nullable) return null;
    throw badRequest("VALIDATION_ERROR", `Das Feld „${name}“ darf nicht leer sein.`);
  }
  return dateQuery(value, name);
}

function currencyField(object) {
  const value = stringField(object, "currency", { maximum: 3 });
  if (value === undefined) return undefined;
  const normalized = value.toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw badRequest("VALIDATION_ERROR", "Die Währung muss ein dreistelliger ISO-Code sein (z. B. EUR).");
  }
  return normalized;
}

/**
 * Liest die Eingabe und legt sie über einen bestehenden Datensatz (PATCH).
 * Validiert anschließend das Gesamtergebnis, damit auch Teil-Updates konsistent bleiben.
 */
function parseExpenseInput(body, existing = null) {
  const input = objectBody(body);
  const pick = (value, fallback) => (value === undefined ? fallback : value);

  const odometerKm = numberField(input, "odometerKm", { nullable: true, minimum: 0, maximum: 10_000_000 });
  const amount = numberField(input, "amount", { required: !existing, minimum: 0, maximum: 1_000_000_000 });

  const merged = {
    vehicleId: pick(input.vehicleId === undefined ? undefined : uuidValue(input.vehicleId, "vehicleId"), existing?.vehicleId),
    category: pick(enumField(input, "category", EXPENSE_CATEGORIES, { required: !existing }), existing?.category),
    date: pick(dateField(input, "date", { required: !existing }), existing?.date),
    amountCents: amount === undefined ? existing?.amountCents : Math.round(amount * 100),
    currency: pick(currencyField(input), existing?.currency ?? "EUR"),
    odometerMeters: odometerKm === undefined
      ? existing?.odometerMeters ?? null
      : odometerKm == null ? null : Math.round(odometerKm * 1000),
    quantity: pick(numberField(input, "quantity", { nullable: true, minimum: 0.001, maximum: 100_000 }), existing?.quantity ?? null),
    quantityUnit: pick(enumField(input, "quantityUnit", QUANTITY_UNITS, { nullable: true }), existing?.quantityUnit ?? null),
    fuelType: pick(enumField(input, "fuelType", FUEL_TYPES, { nullable: true }), existing?.fuelType ?? null),
    fullTank: pick(booleanField(input, "fullTank"), existing?.fullTank ?? false),
    periodStart: pick(dateField(input, "periodStart", { nullable: true }), existing?.periodStart ?? null),
    periodEnd: pick(dateField(input, "periodEnd", { nullable: true }), existing?.periodEnd ?? null),
    tripId: pick(
      input.tripId === undefined ? undefined : input.tripId === null || input.tripId === "" ? null : uuidValue(input.tripId, "tripId"),
      existing?.tripId ?? null,
    ),
    vendor: pick(stringField(input, "vendor", { nullable: true, maximum: 200 }), existing?.vendor ?? null) || null,
    notes: pick(stringField(input, "notes", { nullable: true, maximum: 2000 }), existing?.notes ?? null) || null,
  };

  if (!merged.vehicleId) {
    throw badRequest("VALIDATION_ERROR", "Das Feld „vehicleId“ ist erforderlich.");
  }

  if (ENERGY_CATEGORIES.has(merged.category)) {
    if (merged.quantity != null && !merged.quantityUnit) {
      merged.quantityUnit = merged.category === "charging" ? "kwh" : "l";
    }
    if (merged.category === "charging" && !merged.fuelType) {
      merged.fuelType = "electric";
    }
    if (merged.quantity == null) {
      merged.quantityUnit = null;
    }
  } else {
    // Wechsel von Tanken auf eine andere Kategorie: Tankfelder verwerfen statt Fehler
    merged.quantity = null;
    merged.quantityUnit = null;
    merged.fuelType = null;
    merged.fullTank = false;
  }

  if ((merged.periodStart == null) !== (merged.periodEnd == null)) {
    throw badRequest("VALIDATION_ERROR", "Für einen Leistungszeitraum werden Beginn und Ende benötigt.");
  }
  if (merged.periodStart && merged.periodEnd < merged.periodStart) {
    throw badRequest("VALIDATION_ERROR", "Das Ende des Leistungszeitraums darf nicht vor dem Beginn liegen.");
  }

  return merged;
}

function rowToState(row) {
  return {
    vehicleId: row.vehicle_id,
    category: row.category,
    date: row.expense_date,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    odometerMeters: row.odometer_meters == null ? null : Number(row.odometer_meters),
    quantity: row.quantity == null ? null : Number(row.quantity),
    quantityUnit: row.quantity_unit,
    fuelType: row.fuel_type,
    fullTank: Boolean(row.full_tank),
    periodStart: row.period_start,
    periodEnd: row.period_end,
    tripId: row.trip_id,
    vendor: row.vendor,
    notes: row.notes,
  };
}

async function assertOwnVehicle(db, userId, vehicleId) {
  const result = await db.query(
    `SELECT id FROM vehicles WHERE id = $1 AND user_id = $2`,
    [vehicleId, userId],
  );
  if (result.rowCount === 0) {
    throw notFound("VEHICLE_NOT_FOUND", "Das Fahrzeug wurde nicht gefunden.");
  }
}

async function assertTripMatches(db, userId, vehicleId, tripId) {
  if (!tripId) return;
  const result = await db.query(
    `SELECT vehicle_id FROM trips WHERE id = $1 AND user_id = $2 AND archived_at IS NULL`,
    [tripId, userId],
  );
  if (result.rowCount === 0) {
    throw notFound("TRIP_NOT_FOUND", "Die Fahrt wurde nicht gefunden.");
  }
  if (result.rows[0].vehicle_id !== vehicleId) {
    throw badRequest("TRIP_VEHICLE_MISMATCH", "Die Fahrt gehört zu einem anderen Fahrzeug.");
  }
}

// Kilometerstände der Belege müssen zeitlich aufsteigend sein – fängt Tippfehler früh ab.
async function assertOdometerSequence(db, userId, state, excludeId = null) {
  if (state.odometerMeters == null) return;
  const params = [userId, state.vehicleId, state.date, excludeId];
  const [previous, next] = await Promise.all([
    db.query(
      `SELECT max(odometer_meters) AS value FROM vehicle_expenses
        WHERE user_id = $1 AND vehicle_id = $2 AND odometer_meters IS NOT NULL
          AND expense_date < $3::date AND ($4::uuid IS NULL OR id <> $4::uuid)`,
      params,
    ),
    db.query(
      `SELECT min(odometer_meters) AS value FROM vehicle_expenses
        WHERE user_id = $1 AND vehicle_id = $2 AND odometer_meters IS NOT NULL
          AND expense_date > $3::date AND ($4::uuid IS NULL OR id <> $4::uuid)`,
      params,
    ),
  ]);
  const before = previous.rows[0]?.value;
  const after = next.rows[0]?.value;
  if (before != null && state.odometerMeters < Number(before)) {
    throw badRequest(
      "ODOMETER_REVERSED",
      `Der Kilometerstand ist kleiner als bei einem früheren Beleg (${Number(before) / 1000} km).`,
    );
  }
  if (after != null && state.odometerMeters > Number(after)) {
    throw badRequest(
      "ODOMETER_SEQUENCE",
      `Der Kilometerstand ist größer als bei einem späteren Beleg (${Number(after) / 1000} km).`,
    );
  }
}

async function loadExpense(db, userId, id) {
  const result = await db.query(`${EXPENSE_SELECT} WHERE e.id = $1 AND e.user_id = $2`, [id, userId]);
  return result.rows[0] || null;
}

/**
 * Verbrauch nach der Volltank-Methode: zwischen zwei vollen Tankungen ergibt die
 * nachgetankte Menge (inkl. Teilbetankungen dazwischen) geteilt durch die gefahrene Strecke
 * den Verbrauch. Getrennt je Einheit, damit Plug-in-Hybride sauber bleiben.
 */
export function computeConsumption(entries, from, to) {
  const byUnit = new Map();
  const sorted = [...entries].sort((a, b) =>
    a.date === b.date ? (a.odometerMeters ?? 0) - (b.odometerMeters ?? 0) : a.date < b.date ? -1 : 1,
  );

  const state = new Map();
  for (const entry of sorted) {
    if (!entry.quantityUnit || entry.quantity == null) continue;
    const unitState = state.get(entry.quantityUnit) || { lastFullOdometer: null, pending: 0, broken: false };
    state.set(entry.quantityUnit, unitState);

    if (entry.odometerMeters == null) {
      // Ohne Kilometerstand lässt sich das Intervall nicht schließen
      unitState.broken = true;
      unitState.pending += entry.quantity;
      continue;
    }

    unitState.pending += entry.quantity;
    if (!entry.fullTank) continue;

    if (unitState.lastFullOdometer != null && !unitState.broken) {
      const distanceMeters = entry.odometerMeters - unitState.lastFullOdometer;
      if (distanceMeters > 0 && entry.date >= from && entry.date <= to) {
        const total = byUnit.get(entry.quantityUnit) || { quantity: 0, distanceMeters: 0, intervals: 0 };
        total.quantity += unitState.pending;
        total.distanceMeters += distanceMeters;
        total.intervals += 1;
        byUnit.set(entry.quantityUnit, total);
      }
    }
    unitState.lastFullOdometer = entry.odometerMeters;
    unitState.pending = 0;
    unitState.broken = false;
  }

  return [...byUnit.entries()].map(([unit, total]) => ({
    unit,
    quantity: Math.round(total.quantity * 1000) / 1000,
    distanceKm: total.distanceMeters / 1000,
    intervals: total.intervals,
    per100Km: total.distanceMeters > 0
      ? Math.round((total.quantity / (total.distanceMeters / 1000)) * 100 * 100) / 100
      : null,
  }));
}

expenseRoutes.get(
  "/",
  asyncHandler(async (request, response) => {
    const userId = request.auth.userId;
    const filters = ["e.user_id = $1"];
    const params = [userId];

    if (request.query.vehicleId) {
      params.push(uuidValue(String(request.query.vehicleId), "vehicleId"));
      filters.push(`e.vehicle_id = $${params.length}`);
    }
    const from = dateQuery(request.query.from, "from");
    if (from) {
      params.push(from);
      filters.push(`e.expense_date >= $${params.length}::date`);
    }
    const to = dateQuery(request.query.to, "to");
    if (to) {
      params.push(to);
      filters.push(`e.expense_date <= $${params.length}::date`);
    }
    if (request.query.category) {
      const category = String(request.query.category);
      if (!EXPENSE_CATEGORIES.includes(category)) {
        throw badRequest("VALIDATION_ERROR", "Der Parameter „category“ enthält einen ungültigen Wert.");
      }
      params.push(category);
      filters.push(`e.category = $${params.length}`);
    }

    const result = await pool.query(
      `${EXPENSE_SELECT}
        WHERE ${filters.join(" AND ")}
        ORDER BY e.expense_date DESC, e.odometer_meters DESC NULLS LAST, e.created_at DESC
        LIMIT 5000`,
      params,
    );
    response.json(result.rows.map(mapExpense));
  }),
);

expenseRoutes.get(
  "/summary",
  asyncHandler(async (request, response) => {
    const userId = request.auth.userId;
    if (!request.query.vehicleId) {
      throw badRequest("VALIDATION_ERROR", "Der Parameter „vehicleId“ ist erforderlich.");
    }
    const vehicleId = uuidValue(String(request.query.vehicleId), "vehicleId");
    await assertOwnVehicle(pool, userId, vehicleId);

    const timeZone = await userTimeZone(pool, userId);
    // Standard: aktuelles Kalenderjahr in der Kontozeitzone
    const currentYear = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric" }).format(new Date());
    const from = dateQuery(request.query.from, "from") || `${currentYear}-01-01`;
    const to = dateQuery(request.query.to, "to") || `${currentYear}-12-31`;
    if (to < from) {
      throw badRequest("VALIDATION_ERROR", "„to“ darf nicht vor „from“ liegen.");
    }

    const [costs, distance, energy] = await Promise.all([
      // Kosten mit Leistungszeitraum werden tagesgenau anteilig auf den Auswertungszeitraum verteilt
      pool.query(
        `WITH allocated AS (
           SELECT e.currency, e.category,
                  CASE
                    WHEN e.period_start IS NULL THEN
                      CASE WHEN e.expense_date BETWEEN $3::date AND $4::date THEN e.amount_cents::numeric ELSE 0 END
                    ELSE
                      e.amount_cents::numeric
                      * GREATEST(0, LEAST(e.period_end, $4::date) - GREATEST(e.period_start, $3::date) + 1)
                      / (e.period_end - e.period_start + 1)
                  END AS cents
             FROM vehicle_expenses e
            WHERE e.user_id = $1 AND e.vehicle_id = $2
         )
         SELECT currency, category, round(sum(cents)) AS cents, count(*) FILTER (WHERE cents > 0) AS entries
           FROM allocated
          WHERE cents > 0
          GROUP BY currency, category
          ORDER BY currency, sum(cents) DESC`,
        [userId, vehicleId, from, to],
      ),
      pool.query(
        `SELECT t.type::text AS type, COALESCE(sum(t.distance_meters), 0) AS meters, count(*) AS trips
           FROM trips t
          WHERE t.vehicle_id = $1
            AND t.archived_at IS NULL
            AND t.status = 'completed'
            AND ${tripLocalStartSql("t", "$2")}::date >= $3::date
            AND ${tripLocalStartSql("t", "$2")}::date <= $4::date
          GROUP BY t.type`,
        [vehicleId, timeZone, from, to],
      ),
      pool.query(
        `SELECT to_char(expense_date, 'YYYY-MM-DD') AS date, odometer_meters, quantity, quantity_unit,
                full_tank, amount_cents, currency, category
           FROM vehicle_expenses
          WHERE user_id = $1 AND vehicle_id = $2 AND category IN ('fuel', 'charging')
            AND expense_date <= $3::date`,
        [userId, vehicleId, to],
      ),
    ]);

    const kmByType = { business: 0, private: 0, commute: 0, unclassified: 0 };
    let tripCount = 0;
    for (const row of distance.rows) {
      kmByType[row.type] = Number(row.meters) / 1000;
      tripCount += Number(row.trips);
    }
    const totalKm = Object.values(kmByType).reduce((sum, value) => sum + value, 0);
    const shares = Object.fromEntries(
      Object.entries(kmByType).map(([type, km]) => [type, totalKm > 0 ? km / totalKm : null]),
    );

    const currencies = new Map();
    for (const row of costs.rows) {
      const entry = currencies.get(row.currency) || { currency: row.currency, totalCents: 0, byCategory: [] };
      entry.totalCents += Number(row.cents);
      entry.byCategory.push({ category: row.category, amount: centsToAmount(row.cents), entries: Number(row.entries) });
      currencies.set(row.currency, entry);
    }

    const round2 = (value) => Math.round(value * 100) / 100;
    const costSummary = [...currencies.values()].map((entry) => {
      const total = entry.totalCents / 100;
      return {
        currency: entry.currency,
        total: round2(total),
        byCategory: entry.byCategory,
        costPerKm: totalKm > 0 ? Math.round((total / totalKm) * 1000) / 1000 : null,
        // Kostenanteil je Fahrtart nach gefahrenen km (Grundlage für den Privatanteil)
        byTripType: Object.fromEntries(
          Object.entries(shares).map(([type, share]) => [type, share == null ? null : round2(total * share)]),
        ),
      };
    });

    const energyEntries = energy.rows.map((row) => ({
      date: row.date,
      odometerMeters: row.odometer_meters == null ? null : Number(row.odometer_meters),
      quantity: row.quantity == null ? null : Number(row.quantity),
      quantityUnit: row.quantity_unit,
      fullTank: Boolean(row.full_tank),
    }));

    const energyTotals = new Map();
    for (const row of energy.rows) {
      if (row.date < from || row.quantity == null) continue;
      const key = `${row.quantity_unit}|${row.currency}`;
      const total = energyTotals.get(key) || { unit: row.quantity_unit, currency: row.currency, quantity: 0, cents: 0, entries: 0 };
      total.quantity += Number(row.quantity);
      total.cents += Number(row.amount_cents);
      total.entries += 1;
      energyTotals.set(key, total);
    }

    response.json({
      vehicleId,
      from,
      to,
      timeZone,
      distance: {
        totalKm: round2(totalKm),
        tripCount,
        byTripType: Object.fromEntries(Object.entries(kmByType).map(([type, km]) => [type, round2(km)])),
        shares,
      },
      costs: costSummary,
      energy: [...energyTotals.values()].map((total) => ({
        unit: total.unit,
        currency: total.currency,
        quantity: Math.round(total.quantity * 1000) / 1000,
        amount: total.cents / 100,
        entries: total.entries,
        averagePricePerUnit: total.quantity > 0 ? Math.round((total.cents / 100 / total.quantity) * 1000) / 1000 : null,
      })),
      consumption: computeConsumption(energyEntries, from, to),
    });
  }),
);

expenseRoutes.get(
  "/:id",
  asyncHandler(async (request, response) => {
    const row = await loadExpense(pool, request.auth.userId, uuidValue(request.params.id));
    if (!row) throw notFound("EXPENSE_NOT_FOUND", "Der Kosteneintrag wurde nicht gefunden.");
    response.json(mapExpense(row));
  }),
);

expenseRoutes.post(
  "/",
  asyncHandler(async (request, response) => {
    const userId = request.auth.userId;
    const state = parseExpenseInput(request.body);
    await assertOwnVehicle(pool, userId, state.vehicleId);
    await assertTripMatches(pool, userId, state.vehicleId, state.tripId);
    await assertOdometerSequence(pool, userId, state);

    const inserted = await pool.query(
      `INSERT INTO vehicle_expenses
         (user_id, vehicle_id, category, expense_date, amount_cents, currency, odometer_meters,
          quantity, quantity_unit, fuel_type, full_tank, period_start, period_end, trip_id, vendor, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [
        userId, state.vehicleId, state.category, state.date, state.amountCents, state.currency,
        state.odometerMeters, state.quantity, state.quantityUnit, state.fuelType, state.fullTank,
        state.periodStart, state.periodEnd, state.tripId, state.vendor, state.notes,
      ],
    );
    response.status(201).json(mapExpense(await loadExpense(pool, userId, inserted.rows[0].id)));
  }),
);

expenseRoutes.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    const userId = request.auth.userId;
    const id = uuidValue(request.params.id);
    const existing = await loadExpense(pool, userId, id);
    if (!existing) throw notFound("EXPENSE_NOT_FOUND", "Der Kosteneintrag wurde nicht gefunden.");

    const state = parseExpenseInput(request.body, rowToState(existing));
    if (state.vehicleId !== existing.vehicle_id) {
      await assertOwnVehicle(pool, userId, state.vehicleId);
    }
    await assertTripMatches(pool, userId, state.vehicleId, state.tripId);
    await assertOdometerSequence(pool, userId, state, id);

    await pool.query(
      `UPDATE vehicle_expenses
          SET vehicle_id = $3, category = $4, expense_date = $5, amount_cents = $6, currency = $7,
              odometer_meters = $8, quantity = $9, quantity_unit = $10, fuel_type = $11, full_tank = $12,
              period_start = $13, period_end = $14, trip_id = $15, vendor = $16, notes = $17
        WHERE id = $1 AND user_id = $2`,
      [
        id, userId, state.vehicleId, state.category, state.date, state.amountCents, state.currency,
        state.odometerMeters, state.quantity, state.quantityUnit, state.fuelType, state.fullTank,
        state.periodStart, state.periodEnd, state.tripId, state.vendor, state.notes,
      ],
    );
    response.json(mapExpense(await loadExpense(pool, userId, id)));
  }),
);

expenseRoutes.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const result = await pool.query(
      `DELETE FROM vehicle_expenses WHERE id = $1 AND user_id = $2`,
      [uuidValue(request.params.id), request.auth.userId],
    );
    if (result.rowCount === 0) throw notFound("EXPENSE_NOT_FOUND", "Der Kosteneintrag wurde nicht gefunden.");
    response.status(204).end();
  }),
);

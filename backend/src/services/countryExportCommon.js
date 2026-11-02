const METERS_PER_MILE = 1609.344;

const DEFAULT_TRIP_TYPE_LABELS = Object.freeze({
  business: "Dienstlich",
  private: "Privat",
  commute: "Arbeitsweg",
  unclassified: "Nicht zugeordnet",
});

function isoDate(value) {
  return value.toISOString().slice(0, 10);
}

export function calendarYearPeriod(now = new Date()) {
  const year = now.getFullYear();

  return {
    from: `${year}-01-01`,
    to: isoDate(now),
    label: String(year),
  };
}

export function unitedKingdomTaxYearPeriod(
  now = new Date(),
) {
  const currentYear = now.getFullYear();
  const currentTaxYearStart = new Date(
    currentYear,
    3,
    6,
  );

  const startYear =
    now >= currentTaxYearStart
      ? currentYear
      : currentYear - 1;

  return {
    from: `${startYear}-04-06`,
    to: isoDate(now),
    label: `${startYear}/${String(
      startYear + 1,
    ).slice(-2)}`,
  };
}

export function distanceForType(
  summary,
  type,
) {
  return Number(
    summary.byType.find(
      (entry) => entry.type === type,
    )?.distanceMeters || 0,
  );
}

function createBaseWarnings({
  summary,
  messages,
  checks,
}) {
  const warnings = [];

  if (
    checks.odometer &&
    summary.missingOdometerCount > 0
  ) {
    warnings.push({
      code: "MISSING_ODOMETER",
      level: "warning",
      message: messages.missingOdometer(
        summary.missingOdometerCount,
      ),
    });
  }

  if (
    checks.businessPurpose &&
    summary.missingPurposeCount > 0
  ) {
    warnings.push({
      code: "MISSING_BUSINESS_PURPOSE",
      level: "warning",
      message: messages.missingPurpose(
        summary.missingPurposeCount,
      ),
    });
  }

  if (
    checks.changeHistory &&
    summary.changedTripCount > 0
  ) {
    warnings.push({
      code: "CHANGED_TRIPS",
      level: "information",
      message: messages.changedTrips(
        summary.changedTripCount,
      ),
    });
  }

  return warnings;
}

export function createCountryExport({
  code,
  name,
  localName = name,
  locale,
  currency,
  distanceUnit = "km",
  reportTitle,
  reportSubtitle,
  taxYearLabel,
  requirements = [],
  disclaimer,
  tripTypeLabels =
    DEFAULT_TRIP_TYPE_LABELS,
  summaryLabels = {},
  tableLabels = {},
  checks = {},
  messages = {},
  getDefaultPeriod =
    calendarYearPeriod,
  extraWarnings = () => [],
}) {
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new Error(
      `Ungültiger Ländercode für Exportmodul: ${code}`,
    );
  }

  const metersPerUnit =
    distanceUnit === "mi"
      ? METERS_PER_MILE
      : 1000;

  const resolvedChecks = {
    odometer: true,
    businessPurpose: true,
    changeHistory: true,
    ...checks,
  };

  const resolvedMessages = {
    missingOdometer: (count) =>
      `${count} Fahrt(en) ohne vollständigen Start- und Endkilometerstand.`,
    missingPurpose: (count) =>
      `${count} dienstliche Fahrt(en) ohne Zweck oder Geschäftspartner.`,
    changedTrips: (count) =>
      `${count} Fahrt(en) enthalten dokumentierte Änderungen.`,
    ...messages,
  };

  const resolvedSummaryLabels = {
    trips: "Fahrten",
    total: "Gesamt",
    business: tripTypeLabels.business,
    private: tripTypeLabels.private,
    commute: tripTypeLabels.commute,
    ...summaryLabels,
  };

  const resolvedTableLabels = {
    date: "Datum",
    route: "Strecke",
    purpose: "Art / Zweck",
    startOdometer: `${distanceUnit} Start`,
    endOdometer: `${distanceUnit} Ende`,
    distance: "Strecke",
    changes: "Änd.",
    vehicle: "Fahrzeug",
    ...tableLabels,
  };

  function formatNumber(value, digits = 1) {
    return Number(value || 0).toLocaleString(
      locale,
      {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      },
    );
  }

  function formatDistance(
    meters,
    digits = 1,
  ) {
    return `${formatNumber(
      Number(meters || 0) / metersPerUnit,
      digits,
    )} ${distanceUnit}`;
  }

  function formatOdometer(
    meters,
    digits = 1,
  ) {
    if (
      meters === null ||
      meters === undefined
    ) {
      return "-";
    }

    return formatNumber(
      Number(meters) / metersPerUnit,
      digits,
    );
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function buildSummaryItems(summary) {
    return [
      {
        label: resolvedSummaryLabels.trips,
        value: String(summary.tripCount),
      },
      {
        label: resolvedSummaryLabels.total,
        value: formatDistance(
          summary.distanceMeters,
        ),
      },
      {
        label:
          resolvedSummaryLabels.business,
        value: formatDistance(
          distanceForType(
            summary,
            "business",
          ),
        ),
      },
      {
        label:
          resolvedSummaryLabels.private,
        value: formatDistance(
          distanceForType(
            summary,
            "private",
          ),
        ),
      },
      {
        label:
          resolvedSummaryLabels.commute,
        value: formatDistance(
          distanceForType(
            summary,
            "commute",
          ),
        ),
      },
    ];
  }

  function buildWarnings(context) {
    return [
      ...createBaseWarnings({
        summary: context.summary,
        messages: resolvedMessages,
        checks: resolvedChecks,
      }),
      ...extraWarnings({
        ...context,
        formatDistance,
      }),
    ];
  }

  function toPublicDefinition(
    now = new Date(),
  ) {
    return {
      code,
      name,
      localName,
      locale,
      currency,
      distanceUnit,
      reportTitle,
      reportSubtitle,
      taxYearLabel,
      requirements,
      defaultPeriod: getDefaultPeriod(now),
    };
  }

  return Object.freeze({
    code,
    name,
    localName,
    locale,
    currency,
    distanceUnit,
    reportTitle,
    reportSubtitle,
    taxYearLabel,
    requirements,
    disclaimer,
    tripTypeLabels:
      Object.freeze({
        ...tripTypeLabels,
      }),
    tableLabels:
      Object.freeze({
        ...resolvedTableLabels,
      }),
    getDefaultPeriod,
    formatDistance,
    formatOdometer,
    formatDate,
    buildSummaryItems,
    buildWarnings,
    toPublicDefinition,
  });
}

import {
  createCountryExport,
  distanceForType,
} from "../countryExportCommon.js";

export default createCountryExport({
  code: "NL",
  name: "Niederlande",
  localName: "Nederland",
  locale: "nl-NL",
  currency: "EUR",
  reportTitle:
    "Rittenregistratie",
  reportSubtitle:
    "Landprofiel Nederland",
  taxYearLabel: "Kalenderjaar",
  tripTypeLabels: {
    business: "Zakelijk",
    private: "Privé",
    commute: "Woon-werk",
    unclassified: "Niet ingedeeld",
  },
  summaryLabels: {
    trips: "Ritten",
    total: "Totaal",
  },
  tableLabels: {
    date: "Datum",
    route: "Route",
    purpose: "Soort / doel",
    changes: "Wijz.",
    vehicle: "Voertuig",
  },
  requirements: [
    "Merk, type en kenteken van het voertuig",
    "Begin- en eindkilometerstand per rit",
    "Vertrek- en aankomstadres",
    "Zakelijke of privéclassificatie",
    "Afwijkende route en privé-omrijkilometers waar van toepassing",
  ],
  extraWarnings({ summary }) {
    const privateMeters =
      distanceForType(
        summary,
        "private",
      );

    if (privateMeters <= 500_000) {
      return [];
    }

    return [
      {
        code: "PRIVATE_DISTANCE_OVER_500_KM",
        level: "warning",
        message:
          "De geregistreerde privéafstand ligt boven 500 km in de gekozen periode.",
      },
    ];
  },
  disclaimer:
    "Deze rittenregistratie gebruikt het Nederlandse landenprofiel. De fiscale behandeling van woon-werkverkeer kan per belastingsoort verschillen.",
});

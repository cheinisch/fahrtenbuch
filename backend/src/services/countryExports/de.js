import {
  createCountryExport,
} from "../countryExportCommon.js";

export default createCountryExport({
  code: "DE",
  name: "Deutschland",
  localName: "Deutschland",
  locale: "de-DE",
  currency: "EUR",
  reportTitle:
    "Fahrtenbuch - Steuerlicher Fahrtennachweis",
  reportSubtitle:
    "Länderprofil Deutschland",
  taxYearLabel: "Kalenderjahr",
  requirements: [
    "Datum und Kilometerstand bei Beginn und Ende jeder Fahrt",
    "Start, Ziel und nachvollziehbare Reiseroute",
    "Konkreter Zweck und Geschäftspartner bei dienstlichen Fahrten",
    "Getrennte Kennzeichnung von Privatfahrten und Arbeitswegen",
    "Nachvollziehbarer Verlauf nachträglicher Änderungen",
  ],
  disclaimer:
    "Der Bericht ist auf die deutsche Fahrtenbuch-Dokumentation ausgerichtet. Die steuerliche Anerkennung hängt von der vollständigen, zeitnahen und nachvollziehbaren Erfassung im konkreten Einzelfall ab.",
});

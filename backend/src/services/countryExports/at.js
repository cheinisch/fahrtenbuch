import {
  createCountryExport,
} from "../countryExportCommon.js";

export default createCountryExport({
  code: "AT",
  name: "Österreich",
  localName: "Österreich",
  locale: "de-AT",
  currency: "EUR",
  reportTitle:
    "Fahrtenbuch - Kilometergeldnachweis",
  reportSubtitle:
    "Länderprofil Österreich",
  taxYearLabel: "Kalenderjahr",
  requirements: [
    "Datum, Ausgangspunkt, Ziel und konkrete Fahrtstrecke",
    "Kilometerstand bei Beginn und Ende",
    "Beruflicher Zweck der Fahrt",
    "Trennung beruflicher und privater Kilometer",
    "Angewendeter Kilometergeldsatz und dessen Gültigkeitszeitraum",
  ],
  disclaimer:
    "Der Bericht ist auf österreichische Fahrten- und Kilometergeldnachweise ausgerichtet. Kilometerhöchstgrenzen und der jeweils gültige Satz müssen für den gewählten Zeitraum geprüft werden.",
});

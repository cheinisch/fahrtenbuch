import {
  createCountryExport,
} from "../countryExportCommon.js";

export default createCountryExport({
  code: "BE",
  name: "Belgien",
  localName: "België / Belgique",
  locale: "nl-BE",
  currency: "EUR",
  reportTitle:
    "Kilometerregistratie / Relevé kilométrique",
  reportSubtitle:
    "Landprofiel België / Profil Belgique",
  taxYearLabel:
    "Kalenderjaar / Année civile",
  tripTypeLabels: {
    business:
      "Zakelijk / Professionnel",
    private: "Privé",
    commute:
      "Woon-werk / Domicile-travail",
    unclassified:
      "Niet ingedeeld / Non classé",
  },
  requirements: [
    "Datum, voertuig en zakelijk doel van de rit",
    "Begin- en eindkilometerstand",
    "Voor de ritdatum geldende kilometervergoeding",
    "Geldigheidsperiode van het toegepaste tarief",
    "Reeds ontvangen vergoedingen",
  ],
  disclaimer:
    "Het Belgische landenprofiel documenteert de ritten. Controleer per ritdatum welk vergoedingsbedrag en welke tariefperiode van toepassing zijn.",
});

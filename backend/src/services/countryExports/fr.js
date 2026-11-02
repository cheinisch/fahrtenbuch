import {
  createCountryExport,
} from "../countryExportCommon.js";

export default createCountryExport({
  code: "FR",
  name: "Frankreich",
  localName: "France",
  locale: "fr-FR",
  currency: "EUR",
  reportTitle:
    "Registre des déplacements professionnels",
  reportSubtitle:
    "Profil fiscal France",
  taxYearLabel: "Année civile",
  tripTypeLabels: {
    business: "Professionnel",
    private: "Privé",
    commute: "Domicile-travail",
    unclassified: "Non classé",
  },
  summaryLabels: {
    trips: "Trajets",
    total: "Distance totale",
  },
  tableLabels: {
    date: "Date",
    route: "Itinéraire",
    purpose: "Type / motif",
    changes: "Modif.",
    vehicle: "Véhicule",
  },
  requirements: [
    "Véhicule utilisé et kilomètres parcourus à titre professionnel",
    "Motif professionnel de chaque déplacement",
    "Puissance fiscale du véhicule pour un calcul au barème kilométrique",
    "Remboursements déjà reçus et frais supplémentaires justifiés",
    "Justification particulière des longs trajets domicile-travail",
  ],
  disclaimer:
    "Ce rapport structure les trajets selon un profil français. Les montants du barème kilométrique, la puissance fiscale et les justificatifs doivent être vérifiés pour l'année fiscale concernée.",
});

import {
  createCountryExport,
  unitedKingdomTaxYearPeriod,
} from "../countryExportCommon.js";

export default createCountryExport({
  code: "GB",
  name: "Vereinigtes Königreich",
  localName: "United Kingdom",
  locale: "en-GB",
  currency: "GBP",
  distanceUnit: "mi",
  getDefaultPeriod:
    unitedKingdomTaxYearPeriod,
  reportTitle:
    "Business mileage record",
  reportSubtitle:
    "United Kingdom tax profile",
  taxYearLabel:
    "Tax year (6 April to 5 April)",
  tripTypeLabels: {
    business: "Business",
    private: "Private",
    commute: "Commuting",
    unclassified: "Unclassified",
  },
  summaryLabels: {
    trips: "Journeys",
    total: "Total mileage",
  },
  tableLabels: {
    date: "Date",
    route: "Journey",
    purpose: "Type / purpose",
    startOdometer: "Start mi",
    endOdometer: "End mi",
    distance: "Miles",
    changes: "Edits",
    vehicle: "Vehicle",
  },
  requirements: [
    "Date and business purpose of every journey",
    "Business miles separated from private and commuting journeys",
    "Vehicle type and total annual business mileage",
    "Mileage below and above the applicable annual threshold",
    "Employer reimbursements already received",
  ],
  disclaimer:
    "This report uses the United Kingdom mileage profile and displays distances in miles. Applicable mileage rates and employer reimbursements must be checked for the selected tax year.",
});

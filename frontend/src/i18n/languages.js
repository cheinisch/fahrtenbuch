// Zentrale Liste der UI-Sprachen – analog zur Android-App (res/values-<code>).
// Namen bewusst in der jeweiligen Sprache, damit man die eigene auch in einer fremden UI findet.
export const LANGUAGES = [
  { code: "de", name: "Deutsch", locale: "de-DE" },
  { code: "en", name: "English", locale: "en-US" },
  { code: "da", name: "Dansk", locale: "da-DK" },
  { code: "es", name: "Español", locale: "es-ES" },
  { code: "fi", name: "Suomi", locale: "fi-FI" },
  { code: "fr", name: "Français", locale: "fr-FR" },
  { code: "it", name: "Italiano", locale: "it-IT" },
  { code: "nb", name: "Norsk bokmål", locale: "nb-NO" },
  { code: "nl", name: "Nederlands", locale: "nl-NL" },
  { code: "pl", name: "Polski", locale: "pl-PL" },
  { code: "pt", name: "Português", locale: "pt-PT" },
  { code: "sv", name: "Svenska", locale: "sv-SE" },
];

export const LANGUAGE_CODES = LANGUAGES.map((language) => language.code);

export function languageName(code) {
  return LANGUAGES.find((language) => language.code === code)?.name ?? code;
}

export function languageLocale(code) {
  return LANGUAGES.find((language) => language.code === code)?.locale ?? "de-DE";
}

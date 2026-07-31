export function csvCell(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

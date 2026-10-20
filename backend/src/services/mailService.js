import nodemailer from "nodemailer";

import {
  fromHeader,
  isMailSettingsComplete,
  resolveMailSettings,
  transportOptions,
} from "./systemSettingsService.js";

// SMTP-Daten kommen aus der Umgebung (SMTP_*).
async function mailer() {
  const settings = resolveMailSettings();
  if (!settings?.host) throw new Error("SMTP ist nicht konfiguriert.");
  if (!isMailSettingsComplete(settings)) throw new Error("SMTP_FROM ist nicht konfiguriert.");
  return { transport: nodemailer.createTransport(transportOptions(settings)), from: fromHeader(settings) };
}

export async function sendVehicleShareInvitation({to,ownerName,vehicleName,acceptUrl,expiresAt}) {
  const { transport, from } = await mailer();
  await transport.sendMail({
    from,to,
    subject:`${ownerName} möchte „${vehicleName}“ mit dir teilen`,
    text:`${ownerName} möchte das Fahrzeug „${vehicleName}“ im Fahrtenbuch mit dir teilen.\n\nBestätigen: ${acceptUrl}\n\nDie Einladung ist gültig bis ${new Date(expiresAt).toLocaleString("de-DE")}.\n\nWenn du diese Freigabe nicht erwartest, ignoriere diese Nachricht.`,
  });
}

/** Test-Mail aus dem Admin-Bereich (Einrichtungsassistent, Administration › E-Mail). */
export async function sendTestMail({ to }) {
  const { transport, from } = await mailer();
  await transport.sendMail({
    from,
    to,
    subject: "Fahrtenbuch: Test-Mail",
    text: "Diese Nachricht bestätigt, dass dein Fahrtenbuch-Server E-Mails versenden kann.\n\nDu musst nichts weiter tun.",
  });
}

/** Monatsbericht mit eingebettetem Logo (CID). */
export async function sendMonthlyReportMail({ to, subject, html, text, logoCid, logoPath }) {
  const { transport, from } = await mailer();
  await transport.sendMail({
    from,
    to,
    subject,
    html,
    text,
    attachments: logoPath ? [{ filename: "fahrtenbuch.png", path: logoPath, cid: logoCid }] : [],
  });
}

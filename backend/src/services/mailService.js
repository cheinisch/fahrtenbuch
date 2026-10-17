import nodemailer from "nodemailer";

import { formatInTimeZone } from "../lib/timezone.js";

// Mailversand ist optional: ohne SMTP_HOST und SMTP_FROM blenden die Clients
// alle Funktionen aus, die eine E-Mail verschicken würden.
export function isMailConfigured() {
  return Boolean(String(process.env.SMTP_HOST || "").trim() && String(process.env.SMTP_FROM || "").trim());
}

function transport() {
  const host=process.env.SMTP_HOST;
  if(!host) throw new Error("SMTP ist nicht konfiguriert.");
  return nodemailer.createTransport({
    host,
    port:Number(process.env.SMTP_PORT || 587),
    secure:String(process.env.SMTP_SECURE || "").toLowerCase()==="true",
    auth:process.env.SMTP_USER ? {user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD || ""} : undefined,
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
}

export async function sendVehicleShareInvitation({to,ownerName,vehicleName,licensePlate,acceptUrl,expiresAt,timeZone}) {
  // Die Einladung gilt nur für das Konto mit der Empfängeradresse
  const from=process.env.SMTP_FROM;
  if(!from) throw new Error("SMTP_FROM ist nicht konfiguriert.");
  const vehicle=licensePlate ? `${vehicleName} (${licensePlate})` : vehicleName;
  const validUntil=formatInTimeZone(expiresAt,timeZone,"de-DE",{dateStyle:"medium",timeStyle:"short"});
  const text=[
    `${ownerName} möchte das Fahrzeug „${vehicle}“ im Fahrtenbuch mit dir teilen.`,
    "",
    `Öffne den folgenden Link, melde dich mit deinem Konto (${to}) an und bestätige die Freigabe:`,
    acceptUrl,
    "",
    `Der Link kann einmal verwendet werden und ist gültig bis ${validUntil}.`,
    "",
    "Wenn du diese Freigabe nicht erwartest, ignoriere diese Nachricht.",
  ].join("\n");
  const html=`<p>${escapeHtml(ownerName)} möchte das Fahrzeug <strong>${escapeHtml(vehicle)}</strong> im Fahrtenbuch mit dir teilen.</p>
<p><a href="${escapeHtml(acceptUrl)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#0f766e;color:#fff;text-decoration:none;font-weight:600">Fahrzeug hinzufügen</a></p>
<p style="color:#555;font-size:13px">Oder diesen Link im Browser öffnen:<br><a href="${escapeHtml(acceptUrl)}">${escapeHtml(acceptUrl)}</a></p>
<p style="color:#555;font-size:13px">Melde dich mit deinem Konto (${escapeHtml(to)}) an. Der Link kann einmal verwendet werden und ist gültig bis ${escapeHtml(validUntil)}.<br>Wenn du diese Freigabe nicht erwartest, ignoriere diese Nachricht.</p>`;
  await transport().sendMail({
    from,to,
    subject:`${ownerName} möchte „${vehicleName}“ mit dir teilen`,
    text,html,
  });
}

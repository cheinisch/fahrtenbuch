import nodemailer from "nodemailer";

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

export async function sendVehicleShareInvitation({to,ownerName,vehicleName,acceptUrl,expiresAt}) {
  const from=process.env.SMTP_FROM;
  if(!from) throw new Error("SMTP_FROM ist nicht konfiguriert.");
  await transport().sendMail({
    from,to,
    subject:`${ownerName} möchte „${vehicleName}“ mit dir teilen`,
    text:`${ownerName} möchte das Fahrzeug „${vehicleName}“ im Fahrtenbuch mit dir teilen.\n\nBestätigen: ${acceptUrl}\n\nDie Einladung ist gültig bis ${new Date(expiresAt).toLocaleString("de-DE")}.\n\nWenn du diese Freigabe nicht erwartest, ignoriere diese Nachricht.`,
  });
}

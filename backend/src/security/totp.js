import QRCode from "qrcode";
import {
  generateSecret,
  generateURI,
  verify,
} from "otplib";

import { config } from "../config.js";

export function createTotpSecret() {
  return generateSecret({ length: 20 });
}

export function createTotpUri(identifier, secret) {
  return generateURI({
    issuer: config.totp.issuer,
    label: identifier,
    secret,
  });
}

export async function createTotpQrCodeDataUrl(uri) {
  return QRCode.toDataURL(uri, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });
}

export async function verifyTotpCode(secret, code) {
  const result = await verify({
    secret,
    token: String(code),
    epochTolerance: 30,
  });

  return result.valid === true;
}

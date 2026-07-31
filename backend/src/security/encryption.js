import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { config } from "../config.js";

function encryptionKey() {
  return createHash("sha256")
    .update("fahrtenbuch:totp:v1:", "utf8")
    .update(config.totp.encryptionKey, "utf8")
    .digest();
}

export function encryptSecret(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(value) {
  const [version, ivText, tagText, ciphertextText] = String(value).split(".");

  if (version !== "v1" || !ivText || !tagText || !ciphertextText) {
    throw new Error("Das verschlüsselte Secret hat ein ungültiges Format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivText, "base64url"),
  );

  decipher.setAuthTag(Buffer.from(tagText, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

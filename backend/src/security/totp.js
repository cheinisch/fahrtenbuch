import {
  createDecipheriv,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function getEncryptionKey() {
  const secret =
    process.env.TOTP_SECRET_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY;

  if (!secret) {
    throw new Error(
      "TOTP_SECRET_ENCRYPTION_KEY ist nicht konfiguriert.",
    );
  }

  return createHash("sha256").update(secret).digest();
}

function decryptSecret(encryptedValue) {
  const [version, ivValue, tagValue, ciphertextValue] =
    String(encryptedValue).split(":");

  if (
    version !== "v1" ||
    !ivValue ||
    !tagValue ||
    !ciphertextValue
  ) {
    throw new Error("Ungültiges TOTP-Secret-Format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );

  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function decodeBase32(value) {
  const normalized = value
    .toUpperCase()
    .replace(/[\s=-]/g, "");

  let bitString = "";

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);

    if (index < 0) {
      throw new Error("Ungültiges Base32-TOTP-Secret.");
    }

    bitString += index.toString(2).padStart(5, "0");
  }

  const bytes = [];

  for (let index = 0; index + 8 <= bitString.length; index += 8) {
    bytes.push(Number.parseInt(bitString.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function createTotp(secret, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", secret)
    .update(counterBuffer)
    .digest();

  const offset = digest[digest.length - 1] & 0x0f;

  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(encryptedSecret, token) {
  const normalizedToken = String(token || "").replace(/\D/g, "");

  if (!/^\d{6}$/.test(normalizedToken)) {
    return false;
  }

  const secret = decodeBase32(decryptSecret(encryptedSecret));
  const currentCounter = Math.floor(Date.now() / 1000 / 30);

  for (const offset of [-1, 0, 1]) {
    const expected = createTotp(secret, currentCounter + offset);

    if (
      timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(normalizedToken),
      )
    ) {
      return true;
    }
  }

  return false;
}
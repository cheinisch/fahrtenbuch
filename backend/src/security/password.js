import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;
const N = 16384;
const R = 8;
const P = 1;

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 10) {
    throw new Error("Das Passwort muss mindestens 10 Zeichen lang sein.");
  }

  const salt = randomBytes(16);

  const derivedKey = await scrypt(
    password,
    salt,
    KEY_LENGTH,
    {
      N,
      r: R,
      p: P,
      maxmem: 64 * 1024 * 1024,
    },
  );

  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    Buffer.from(derivedKey).toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password, storedHash) {
  if (
    typeof password !== "string" ||
    typeof storedHash !== "string"
  ) {
    return false;
  }

  const parts = storedHash.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, nValue, rValue, pValue, saltValue, hashValue] = parts;

  const expectedHash = Buffer.from(hashValue, "base64url");
  const salt = Buffer.from(saltValue, "base64url");

  const actualHash = await scrypt(
    password,
    salt,
    expectedHash.length,
    {
      N: Number(nValue),
      r: Number(rValue),
      p: Number(pValue),
      maxmem: 64 * 1024 * 1024,
    },
  );

  const actualBuffer = Buffer.from(actualHash);

  return (
    actualBuffer.length === expectedHash.length &&
    timingSafeEqual(actualBuffer, expectedHash)
  );
}
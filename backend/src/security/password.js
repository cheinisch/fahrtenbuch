import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("Das Passwort muss mindestens acht Zeichen lang sein.");
  }

  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: MAX_MEMORY,
  });

  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    Buffer.from(key).toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password, encodedHash) {
  try {
    const [algorithm, n, r, p, saltText, hashText] = String(encodedHash).split("$");

    if (algorithm !== "scrypt" || !saltText || !hashText) {
      return false;
    }

    const expected = Buffer.from(hashText, "base64url");
    const actual = Buffer.from(
      await scrypt(password, Buffer.from(saltText, "base64url"), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: MAX_MEMORY,
      }),
    );

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

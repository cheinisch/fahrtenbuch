import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

function readFile(name, fallback) {
  try {
    return fs.readFileSync(path.join(root, name), "utf8").trim();
  } catch {
    return fallback;
  }
}

export const APP_VERSION = readFile("VERSION", "unknown");
export const BUILD_NUMBER = readFile("BUILD", "0");

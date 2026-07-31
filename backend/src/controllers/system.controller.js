import { APP_VERSION } from "../config/version.js";

export function healthController(req, res) {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
}

export function versionController(req, res) {
  res.json({ version: APP_VERSION });
}

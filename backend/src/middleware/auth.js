import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Token fehlt" } });

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Token ungültig" } });
  }
}

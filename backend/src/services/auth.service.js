import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { pool } from "../database/pool.js";
import { env } from "../config/env.js";
import { AppError } from "../errors/AppError.js";

export async function login({ email, password }) {
  const result = await pool.query(
    "SELECT id, email, login_name, display_name, password_hash, role FROM users WHERE lower(email)=lower($1)",
    [email]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, "INVALID_CREDENTIALS", "E-Mail oder Passwort ist falsch");
  }
  const accessToken = jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.jwtSecret, { expiresIn: "15m" });
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  return { accessToken, refreshToken, expiresIn: 900, user };
}

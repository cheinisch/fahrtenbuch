import { login } from "../services/auth.service.js";

export async function loginController(req, res) {
  res.json(await login(req.body));
}

export async function logoutController(req, res) {
  res.status(204).end();
}

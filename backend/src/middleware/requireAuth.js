import { verifyAccessToken } from "../security/tokens.js";

export function requireAuth(request, response, next) {
  const authorization = request.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return response.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Eine Anmeldung ist erforderlich.",
      },
    });
  }

  try {
    const token = authorization.slice("Bearer ".length);
    const payload = verifyAccessToken(token);

    request.auth = {
      userId: payload.sub,
      sessionId: payload.sid,
      role: payload.role,
    };

    next();
  } catch {
    return response.status(401).json({
      error: {
        code: "TOKEN_INVALID",
        message: "Die Sitzung ist abgelaufen oder ungültig.",
      },
    });
  }
}
import { forbidden } from "../lib/errors.js";

export function requireAdmin(request, _response, next) {
  if (request.auth?.role !== "admin") {
    return next(
      forbidden(
        "ADMIN_REQUIRED",
        "Für diese Funktion sind Administratorrechte erforderlich.",
      ),
    );
  }

  next();
}

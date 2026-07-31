import { ApiError } from "../lib/errors.js";

export function notFoundHandler(request, response) {
  response.status(404).json({
    error: "ROUTE_NOT_FOUND",
    message: "Die angeforderte API-Route wurde nicht gefunden.",
    details: {
      method: request.method,
      path: request.originalUrl,
    },
    requestId: request.requestId || null,
  });
}

export function errorHandler(error, request, response, _next) {
  if (response.headersSent) {
    return;
  }

  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "Die Anfrage konnte nicht verarbeitet werden.";
  let details = null;

  if (error instanceof ApiError) {
    status = error.status;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error?.type === "entity.too.large") {
    status = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "Der Request-Body ist zu groß.";
  } else if (error?.code === "23505") {
    status = 409;
    code = "CONFLICT";
    message = "Ein Datensatz mit diesen Angaben existiert bereits.";
    details = { constraint: error.constraint || null };
  } else if (error?.code === "23503") {
    status = 400;
    code = "REFERENCE_ERROR";
    message = "Ein referenzierter Datensatz existiert nicht oder gehört einem anderen Benutzer.";
    details = { constraint: error.constraint || null };
  } else if (error?.code === "22P02") {
    status = 400;
    code = "VALIDATION_ERROR";
    message = "Ein übermittelter Wert hat ein ungültiges Format.";
  }

  if (status >= 500) {
    console.error(`[${request.requestId || "no-request-id"}]`, error);
  }

  response.status(status).json({
    error: code,
    message,
    details,
    requestId: request.requestId || null,
  });
}

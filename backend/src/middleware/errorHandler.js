export function errorHandler(error, req, res, next) {
  const status = error.status || 500;
  res.status(status).json({
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: status === 500 ? "Interner Serverfehler" : error.message,
      details: error.details
    }
  });
}

export class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details = null) =>
  new ApiError(400, code, message, details);

export const unauthorized = (code, message, details = null) =>
  new ApiError(401, code, message, details);

export const forbidden = (code, message, details = null) =>
  new ApiError(403, code, message, details);

export const notFound = (code, message, details = null) =>
  new ApiError(404, code, message, details);

export const conflict = (code, message, details = null) =>
  new ApiError(409, code, message, details);

export const payloadTooLarge = (code, message, details = null) =>
  new ApiError(413, code, message, details);

export const serviceUnavailable = (code, message, details = null) =>
  new ApiError(503, code, message, details);

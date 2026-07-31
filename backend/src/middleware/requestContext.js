import { randomUUID } from "node:crypto";

export function requestContext(request, response, next) {
  request.requestId = request.get("x-request-id") || randomUUID();
  response.setHeader("x-request-id", request.requestId);
  next();
}

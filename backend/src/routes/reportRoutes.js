import { Router } from "express";

import { config } from "../config.js";
import { badRequest, notFound } from "../lib/errors.js";
import { objectBody } from "../lib/validation.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { deliverMonthlyReport } from "../services/monthlyReportDelivery.js";
import { buildMonthlyReport } from "../services/monthlyReportService.js";
import { isMailConfigured } from "../services/systemSettingsService.js";

export const reportRoutes = Router();

reportRoutes.use(requireAuth);

// Monatsbericht (Standard: Vormonat in der Kontozeitzone) – gleicher Inhalt wie die Mail
reportRoutes.get(
  "/monthly",
  asyncHandler(async (request, response) => {
    response.json(await buildMonthlyReport(request.auth.userId, request.query.month));
  }),
);

// Bericht sofort an die eigene Adresse senden, auch für einen leeren Monat.
// Nur im dev-Image (Testen/Debuggen), sonst 404 wie andere Vorschaufunktionen.
reportRoutes.post(
  "/monthly/send",
  asyncHandler(async (request, response) => {
    if (!config.features.monthlyReportSendNow) {
      throw notFound("FEATURE_DISABLED", "Das sofortige Senden des Monatsberichts ist nur im dev-Image verfügbar.");
    }
    if (!isMailConfigured()) {
      throw badRequest("MAIL_NOT_CONFIGURED", "Auf diesem Server ist kein E-Mail-Versand eingerichtet.");
    }
    const body = objectBody(request.body ?? {});
    const report = await buildMonthlyReport(request.auth.userId, body.month);
    try {
      const result = await deliverMonthlyReport(request.auth.userId, report.month, { force: true });
      response.json({ sent: result.status === "sent", to: result.to || null, month: report.month });
    } catch (error) {
      throw badRequest("MAIL_SEND_FAILED", `Der Monatsbericht konnte nicht gesendet werden: ${error.message}`);
    }
  }),
);

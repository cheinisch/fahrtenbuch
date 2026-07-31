import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { listTrips, createTrip } from "../controllers/trips.controller.js";
const router = Router();
router.get("/", requireAuth, asyncHandler(listTrips));
router.post("/", requireAuth, asyncHandler(createTrip));
export default router;

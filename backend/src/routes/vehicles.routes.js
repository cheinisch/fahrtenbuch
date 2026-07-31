import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { listVehicles, createVehicle } from "../controllers/vehicles.controller.js";
const router = Router();
router.get("/", requireAuth, asyncHandler(listVehicles));
router.post("/", requireAuth, asyncHandler(createVehicle));
export default router;

import { Router } from "express";
import { healthController, versionController } from "../controllers/system.controller.js";
const router = Router();
router.get("/health", healthController);
router.get("/version", versionController);
export default router;

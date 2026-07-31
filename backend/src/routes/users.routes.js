import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { meController } from "../controllers/users.controller.js";
const router = Router();
router.get("/me", requireAuth, asyncHandler(meController));
export default router;

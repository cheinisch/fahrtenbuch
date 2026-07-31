import { Router } from "express";
import { loginController, logoutController } from "../controllers/auth.controller.js";
import { asyncHandler } from "../utils/asyncHandler.js";
const router = Router();
router.post("/login", asyncHandler(loginController));
router.post("/logout", logoutController);
export default router;

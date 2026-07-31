import { Router } from "express";
import authRoutes from "../../routes/auth.routes.js";
import systemRoutes from "../../routes/system.routes.js";
import usersRoutes from "../../routes/users.routes.js";
import vehiclesRoutes from "../../routes/vehicles.routes.js";
import tripsRoutes from "../../routes/trips.routes.js";

const router = Router();
router.use("/auth", authRoutes);
router.use("/system", systemRoutes);
router.use("/users", usersRoutes);
router.use("/vehicles", vehiclesRoutes);
router.use("/trips", tripsRoutes);
export default router;

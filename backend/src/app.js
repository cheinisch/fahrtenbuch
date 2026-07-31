import express from "express";
import cors from "cors";
import helmet from "helmet";
import apiV1 from "./api/v1/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

export const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/api/v1", apiV1);
app.use(notFound);
app.use(errorHandler);

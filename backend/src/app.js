import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import apiV1 from "./api/v1/index.js";
import { notFound } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(currentDirectory, "../../frontend/dist");

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api/v1", apiV1);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(frontendDirectory));
  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api/")) {
      return next();
    }

    return response.sendFile(path.join(frontendDirectory, "index.html"));
  });
}

app.use(notFound);
app.use(errorHandler);

import "dotenv/config";

export const env = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || "postgresql://fahrtenbuch:fahrtenbuch@localhost:5432/fahrtenbuch",
  jwtSecret: process.env.JWT_SECRET || "change-me",
  nodeEnv: process.env.NODE_ENV || "development"
};

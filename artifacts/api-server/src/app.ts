import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";
import router from "./routes";

const isProduction = process.env.NODE_ENV === "production";

if (!process.env.SESSION_SECRET) {
  if (isProduction) {
    throw new Error("SESSION_SECRET environment variable must be set in production");
  }
  console.warn("WARNING: SESSION_SECRET not set. Using development fallback. Set SESSION_SECRET for production.");
}

const sessionSecret = process.env.SESSION_SECRET || "dev-only-elebhar-fms-secret";

const app: Express = express();

if (isProduction) {
  app.set("trust proxy", 1);
}

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionPool = new Pool({ connectionString: process.env.DATABASE_URL });
const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool: sessionPool,
      tableName: "session",
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: "efms.sid",
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
    },
  })
);

app.use("/api", router);

export default app;

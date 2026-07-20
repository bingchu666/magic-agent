import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to your .env file.");
}

// prepare: false is recommended for Supabase's transaction pooler (port 6543)
const client = postgres(process.env.DATABASE_URL, { prepare: false });

export const dbClient = drizzle(client, { schema });
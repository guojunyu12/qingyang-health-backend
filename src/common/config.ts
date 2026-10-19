import dotenv from "dotenv";
import { resolve } from "node:path";
// Explicit server-only config; never loaded by the frontend.
dotenv.config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
export const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
};
export const production = process.env.NODE_ENV === "production";
export const origin = env("APP_ORIGIN", "http://127.0.0.1:3001");

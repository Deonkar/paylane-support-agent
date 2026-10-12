import { existsSync } from "node:fs";
import { z } from "zod";

const MISSING_KEY = "GEMINI_API_KEY is missing: copy .env.example to .env and add a key";

const schema = z.object({
  GEMINI_API_KEY: z.string({ error: MISSING_KEY }).trim().min(1, MISSING_KEY),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.5-flash-lite"),
  TYPESAFE_API_KEY: z.string().trim().optional(),
});

export interface Config {
  geminiApiKey: string;
  geminiModel: string;
  /** Absent or blank means Jev is off. */
  typesafeApiKey: string | null;
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  const { GEMINI_API_KEY, GEMINI_MODEL, TYPESAFE_API_KEY } = parsed.data;
  return {
    geminiApiKey: GEMINI_API_KEY,
    geminiModel: GEMINI_MODEL,
    typesafeApiKey: TYPESAFE_API_KEY || null,
  };
}

export function loadConfig(): Config {
  if (existsSync(".env")) process.loadEnvFile(".env");
  return parseConfig(process.env);
}

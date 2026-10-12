import { existsSync } from "node:fs";
import { z } from "zod";

const MISSING_KEY = "GEMINI_API_KEY is missing: copy .env.example to .env and add a key";

/** A blank line copied from .env.example means "use the default". */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const schema = z.object({
  GEMINI_API_KEY: z.string({ error: MISSING_KEY }).trim().min(1, MISSING_KEY),
  GEMINI_MODEL: z.preprocess(blank, z.string().trim().default("gemini-3.5-flash-lite")),
  GEMINI_RPM: z.preprocess(blank, z.coerce.number().int().positive().default(14)),
  TYPESAFE_API_KEY: z.string().trim().optional(),
});

export interface Config {
  geminiApiKey: string;
  geminiModel: string;
  /** Gemini requests per minute; the free tier allows 15 per model. */
  geminiRpm: number;
  /** Absent or blank means Jev is off. */
  typesafeApiKey: string | null;
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  const { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_RPM, TYPESAFE_API_KEY } = parsed.data;
  return {
    geminiApiKey: GEMINI_API_KEY,
    geminiModel: GEMINI_MODEL,
    geminiRpm: GEMINI_RPM,
    typesafeApiKey: TYPESAFE_API_KEY || null,
  };
}

export function loadConfig(): Config {
  if (existsSync(".env")) process.loadEnvFile(".env");
  return parseConfig(process.env);
}

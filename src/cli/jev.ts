// Ask Jev a yes/no question about a file: `pnpm jev <file> "<question>" ["<question>" ...]`.
// Prints the probability of "yes" for each. An audit aid: a judgment, not proof.
import { existsSync, readFileSync } from "node:fs";
import { createJevClient } from "../jev/client.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const [file, ...questions] = process.argv.slice(2);
const key = process.env.TYPESAFE_API_KEY?.trim();
if (!file || questions.length === 0) throw new Error('usage: pnpm jev <file> "<question>" ["<question>" ...]');
if (!key) throw new Error("TYPESAFE_API_KEY is not set in .env");

const jev = createJevClient({ apiKey: key });
const asked = Object.fromEntries(
  questions.map((q, i) => [`q${i + 1}`, { type: "noul" as const, instructions: `About \`document\`: ${q}` }]),
);
const answers = await jev.nouls({ document: readFileSync(file, "utf8") }, asked);
if (!answers) throw new Error("Jev did not answer");
questions.forEach((q, i) => {
  console.log(`${(answers[`q${i + 1}`] ?? 0).toFixed(2)}  ${q}`);
});

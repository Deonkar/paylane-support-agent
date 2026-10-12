// One-off: POST a payload file to Jev. Reads TYPESAFE_API_KEY from an env file and never prints it.
// Usage: node jev-ask.mjs <env-file> <payload.json>
import { readFileSync } from "node:fs";

const [envFile, payloadFile] = process.argv.slice(2);
const line = readFileSync(envFile, "utf8")
  .split(/\r?\n/)
  .find((l) => /^\s*TYPESAFE_API_KEY\s*=/.test(l));
if (!line) {
  console.error("TYPESAFE_API_KEY not found in the env file");
  process.exit(2);
}
const key = line.replace(/^\s*TYPESAFE_API_KEY\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");

const res = await fetch("https://api.typesafe.ai/v1/systemone", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: readFileSync(payloadFile, "utf8"),
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  process.exit(1);
}
console.log(text);

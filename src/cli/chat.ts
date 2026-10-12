// Chat with the agent in a terminal: `pnpm chat` or `pnpm chat 06` to see that test customer's details.
import { createInterface } from "node:readline";
import { respond } from "../agent/loop.ts";
import { loadConfig } from "../config.ts";
import { FIXTURES } from "../paylane/fixtures.ts";
import { createRuntime } from "../runtime.ts";
import { toTranscriptLines } from "../shared/transcript.ts";

const runtime = createRuntime(loadConfig());
const { session, deps } = runtime.newChat("cli");
const pick = FIXTURES.find((f) => f.customer.id === `cus_${process.argv[2] ?? ""}`);
const dim = (s: string) => `\u001b[2m${s}\u001b[0m`;
const prompt = () => {
  if (process.stdin.isTTY) process.stdout.write("you > ");
};

console.log(`Paylane support agent · model ${runtime.model} · Jev ${runtime.jev} · synthetic data`);
if (pick) {
  const { name, email, card_last4 } = pick.customer;
  const txns = pick.transactions.map((t) => t.id).join(", ");
  console.log(`Testing as ${name}: ${email}, card ending ${card_last4}, ${txns}`);
}
console.log('Type a message, or "exit".\n');

let printed = 0;
prompt();
for await (const raw of createInterface({ input: process.stdin })) {
  const text = raw.trim();
  if (text === "exit") break;
  if (text) {
    if (!process.stdin.isTTY) console.log(`you > ${text}`);
    await respond(session, text, deps);
    for (const line of toTranscriptLines(session.events).slice(printed)) {
      if (line.kind === "note") console.log(dim(`  ${line.n}. ${line.text}`));
      if (line.kind === "agent") console.log(`agent > ${line.text}\n`);
      printed = line.n;
    }
  }
  prompt();
}
process.exit(0);

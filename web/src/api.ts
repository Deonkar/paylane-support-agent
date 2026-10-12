import { z } from "zod";
import { type TraceEvent, traceEvent } from "../../src/shared/events.ts";

const customer = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  cardLast4: z.string(),
  status: z.enum(["active", "frozen"]),
  situation: z.string(),
  transactions: z.array(
    z.object({
      id: z.string(),
      amountCents: z.number(),
      merchant: z.string(),
      daysAgo: z.number(),
      status: z.string(),
    }),
  ),
});
export type Customer = z.infer<typeof customer>;

const meta = z.object({ model: z.string(), jev: z.string() });
export type Meta = z.infer<typeof meta>;

async function json<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return schema.parse(await res.json());
}

export async function loadPlayground(): Promise<{ meta: Meta; customers: Customer[] }> {
  const [m, c] = await Promise.all([fetch("api/meta"), fetch("api/customers")]);
  return { meta: await json(m, meta), customers: await json(c, z.array(customer)) };
}

export async function newSession(): Promise<string> {
  const res = await fetch("api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return (await json(res, z.object({ sessionId: z.string() }))).sessionId;
}

/** Sends a message and calls `onEvent` for each trace event as the server streams it. */
export async function sendMessage(sessionId: string, text: string, onEvent: (e: TraceEvent) => void): Promise<void> {
  const res = await fetch(`api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) throw new Error(`${res.status}: ${await res.text()}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const kind = /^event: (\w+)/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (kind === "trace" && data) onEvent(traceEvent.parse(JSON.parse(data)));
    }
  }
}

// The Playground: `pnpm playground` (builds the UI first). Serves on http://localhost:8787, localhost only.
import { loadConfig } from "../config.ts";
import { createRuntime } from "../runtime.ts";
import { createAppServer } from "../server/http.ts";

const port = Number(process.env.PORT ?? 8787);
const runtime = createRuntime(loadConfig());
createAppServer(runtime, { staticDir: "web/dist" }).listen(port, "127.0.0.1", () => {
  console.log(`Playground on http://localhost:${port} · model ${runtime.model} · Jev ${runtime.jev}`);
});

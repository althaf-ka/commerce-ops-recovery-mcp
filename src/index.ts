import { createMcpHandler } from "agents/mcp/server";
import { Hono } from "hono";
import type { AppEnv } from "./env.js";
import { createMcpServer } from "./mcp/create-server.js";
import { healthRoutes } from "./routes/health.js";

const app = new Hono<AppEnv>();

app.route("/health", healthRoutes);
app.all("/mcp", (c) => {
  const mcpHandler = createMcpHandler(() => createMcpServer(c.env), {
    route: "/mcp",
  });

  return mcpHandler.fetch(c.req.raw);
});

export { app };
export default app;

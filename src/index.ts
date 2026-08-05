import { createMcpHandler } from 'agents/mcp/server';
import { Hono } from 'hono';
import { SERVICE_METADATA } from './config/service-metadata.js';
import type { AppEnv } from './env.js';
import { createMcpServer } from './mcp/create-server.js';
import { healthRoutes } from './routes/health.js';

const app = new Hono<AppEnv>();

app.get('/', (c) => {
  const baseUrl = new URL(c.req.url).origin;

  return c.json({
    service: SERVICE_METADATA.name,
    status: 'running',
    description: SERVICE_METADATA.description,
    author: SERVICE_METADATA.author,
    transport: 'Streamable HTTP',
    mcpEndpoint: `${baseUrl}/mcp`,
    healthEndpoints: {
      service: `${baseUrl}/health`,
      database: `${baseUrl}/health/database`,
    },
    usage: 'Connect the MCP endpoint using a compatible remote MCP client.',
    firstTool: 'get_demo_guide',
  });
});

app.route('/health', healthRoutes);
app.all('/mcp', (c) => {
  const mcpHandler = createMcpHandler(() => createMcpServer(c.env), {
    route: '/mcp',
  });

  return mcpHandler.fetch(c.req.raw);
});

export { app };
export default app;

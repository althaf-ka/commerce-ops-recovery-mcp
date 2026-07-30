import { Hono } from 'hono'
import { createMcpHandler } from 'agents/mcp/server'
import type { AppEnv } from './env.js'
import { createMcpServer } from './mcp/create-server.js'

const app = new Hono<AppEnv>()

const mcpHandler = createMcpHandler(createMcpServer, {
  route: '/mcp',
})

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'commerce-ops-recovery-mcp',
    version: '0.1.0',
  }),
)
app.all('/mcp', (c) => mcpHandler.fetch(c.req.raw))

export { app }
export default app

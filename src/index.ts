import { Hono } from 'hono'
import { createMcpHandler } from 'agents/mcp/server'
import type { AppEnv } from './env.js'
import { createMcpServer } from './mcp/create-server.js'
import { healthRoutes } from './routes/health.js'

const app = new Hono<AppEnv>()

const mcpHandler = createMcpHandler(createMcpServer, {
  route: '/mcp',
})

app.route('/health', healthRoutes)
app.all('/mcp', (c) => mcpHandler.fetch(c.req.raw))

export { app }
export default app

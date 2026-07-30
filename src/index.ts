import { Hono } from 'hono'
import { createMcpHandler } from 'agents/mcp/server'
import type { AppEnv } from './env.js'
import { createServer } from './mcp/create-server.js'

const app = new Hono<AppEnv>()

const mcpHandler = createMcpHandler(createServer)

app.get('/', (c) => c.text('ok'))
app.all('/mcp', (c) => mcpHandler.fetch(c.req.raw))

export { app }
export default app

import { Hono } from 'hono'
import { createMcpHandler } from 'agents/mcp/server'
import { checkDatabaseConnectivity } from './db/connectivity.js'
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
app.get('/health/database', async (c) => {
  try {
    const connected = await checkDatabaseConnectivity(c.env)

    return c.json({
      status: 'ok',
      connected,
    })
  } catch (error) {
    console.error({
      event: 'database_connectivity_check_failed',
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
            }
          : {
              name: 'UnknownError',
            },
    })

    return c.json(
      {
        status: 'error',
        connected: 0,
      },
      503,
    )
  }
})
app.all('/mcp', (c) => mcpHandler.fetch(c.req.raw))

export { app }
export default app

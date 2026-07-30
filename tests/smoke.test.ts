import { describe, expect, it } from 'vitest'
import { app } from '../src/index.js'

describe('smoke', () => {
  it('responds to a root GET request', async () => {
    const res = await app.request(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toBe('ok')
  })

  it('responds to MCP POST requests', async () => {
    const res = await app.request(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          host: 'localhost',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: {
              name: 'smoke-test',
              version: '1.0.0',
            },
          },
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const body = await res.text()
    expect(body).toContain('"name":"commerce-ops-recovery-mcp"')
    expect(body).toContain('"version":"0.1.0"')
  })
})

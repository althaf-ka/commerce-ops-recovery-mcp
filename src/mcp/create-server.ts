import { McpServer } from '@modelcontextprotocol/server'

export function createServer(): McpServer {
  return new McpServer({
    name: 'commerce-ops-recovery-mcp',
    version: '0.1.0',
  })
}

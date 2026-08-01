import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'commerce-ops-recovery',
    version: '0.1.0',
  });

  server.registerTool(
    'ping',
    {
      description: 'Confirm that the MCP server is responding.',
      inputSchema: z.object({
        message: z.string().min(1),
      }),
      outputSchema: z.object({
        received: z.string(),
      }),
    },
    async ({ message }) => ({
      content: [
        {
          type: 'text',
          text: `Received: ${message}`,
        },
      ],
      structuredContent: {
        received: message,
      },
    }),
  );

  return server;
}

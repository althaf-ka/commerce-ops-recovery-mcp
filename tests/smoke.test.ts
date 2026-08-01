import { describe, expect, it } from 'vitest';
import { app } from '../src/index.js';

const protocolVersion = '2025-06-18';

type McpRequest = {
  id: number;
  method: string;
  params: Record<string, unknown>;
};

async function sendMcpRequest({ id, method, params }: McpRequest) {
  const response = await app.request(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        host: 'localhost',
        'mcp-protocol-version': protocolVersion,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }),
    }),
  );

  const responseText = await response.text();
  const contentType = response.headers.get('content-type');

  if (contentType?.includes('text/event-stream')) {
    const data = responseText
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice('data: '.length);

    if (data === undefined) {
      throw new Error('MCP response did not contain an SSE data event');
    }

    return {
      body: JSON.parse(data) as unknown,
      response,
    };
  }

  return {
    body: JSON.parse(responseText) as unknown,
    response,
  };
}

describe('HTTP health endpoint', () => {
  it('reports service health', async () => {
    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'commerce-ops-recovery-mcp',
      version: '0.1.0',
    });
  });
});

describe('MCP endpoint', () => {
  it('initializes the server', async () => {
    const { body, response } = await sendMcpRequest({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: {
          name: 'smoke-test',
          version: '1.0.0',
        },
      },
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: {
          name: 'commerce-ops-recovery',
          version: '0.1.0',
        },
      },
    });
  });

  it('lists the ping tool', async () => {
    const { body, response } = await sendMcpRequest({
      id: 2,
      method: 'tools/list',
      params: {},
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        tools: [
          {
            name: 'ping',
            description: 'Confirm that the MCP server is responding.',
          },
        ],
      },
    });
  });

  it('calls the ping tool', async () => {
    const { body, response } = await sendMcpRequest({
      id: 3,
      method: 'tools/call',
      params: {
        name: 'ping',
        arguments: {
          message: 'hello',
        },
      },
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: {
        content: [
          {
            type: 'text',
            text: 'Received: hello',
          },
        ],
        structuredContent: {
          received: 'hello',
        },
      },
    });
  });

  it.each([
    ['an empty message', ''],
    ['an incorrectly typed message', 42],
  ])('rejects %s', async (_case, message) => {
    const { body, response } = await sendMcpRequest({
      id: 4,
      method: 'tools/call',
      params: {
        name: 'ping',
        arguments: {
          message,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 4,
      result: {
        isError: true,
      },
    });
  });
});

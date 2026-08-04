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

  it('lists the order recovery tools with accurate safety annotations', async () => {
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
            name: 'investigate_order',
            title: 'Investigate order recovery',
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
          },
          {
            name: 'prepare_recovery_plan',
            title: 'Prepare order recovery plan',
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: false,
            },
          },
        ],
      },
    });
  });

  it.each([
    ['an empty order number', ''],
    ['an incorrectly typed order number', 42],
  ])('rejects %s', async (_case, orderNumber) => {
    const { body, response } = await sendMcpRequest({
      id: 4,
      method: 'tools/call',
      params: {
        name: 'investigate_order',
        arguments: {
          orderNumber,
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

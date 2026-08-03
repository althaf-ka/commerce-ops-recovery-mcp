import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { describe, expect, it, vi } from 'vitest';
import type { InvestigateOrderResult } from '../../../../src/modules/order-recovery/application/investigate-order.js';
import { registerInvestigateOrderTool } from '../../../../src/modules/order-recovery/mcp/investigate-order.tool.js';

async function callInvestigateOrderTool(
  investigateOrder: (orderNumber: string) => Promise<InvestigateOrderResult>,
) {
  const handler = createMcpHandler(() => {
    const server = new McpServer({
      name: 'investigate-order-tool-test',
      version: '0.1.0',
    });
    registerInvestigateOrderTool(server, investigateOrder);
    return server;
  });

  const response = await handler.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        host: 'localhost',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'investigate_order',
          arguments: { orderNumber: 'ORD-DEMO-1042' },
        },
      }),
    }),
  );

  const responseText = await response.text();
  const data = response.headers
    .get('content-type')
    ?.includes('text/event-stream')
    ? responseText
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length)
    : responseText;

  if (data === undefined) {
    throw new Error('MCP response did not contain a result');
  }

  return JSON.parse(data) as {
    result: {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
  };
}

describe('investigate_order tool', () => {
  it('returns a focused recovery decision without exposing the snapshot', async () => {
    const investigateOrder =
      vi.fn<(orderNumber: string) => Promise<InvestigateOrderResult>>();
    investigateOrder.mockResolvedValue({
      found: true,
      orderNumber: 'ORD-DEMO-1042',
      orderVersion: 1,
      snapshot: {
        order: {
          id: 'order-1',
          orderNumber: 'ORD-DEMO-1042',
          localPaymentStatus: 'pending',
          orderStatus: 'awaiting_payment',
          version: 1,
        },
        items: [],
        payment: null,
        webhookEvents: [],
        fulfillment: null,
      },
      eligibility: {
        recoverable: true,
        reason: 'RECOVERABLE',
        evidence: ['Recovery evidence'],
      },
      mutated: false,
    });

    const body = await callInvestigateOrderTool(investigateOrder);

    expect(investigateOrder).toHaveBeenCalledWith('ORD-DEMO-1042');
    expect(body.result.structuredContent).toEqual({
      found: true,
      orderNumber: 'ORD-DEMO-1042',
      orderVersion: 1,
      recoverable: true,
      reason: 'RECOVERABLE',
      evidence: ['Recovery evidence'],
      recommendedNextAction:
        'Prepare a recovery plan for explicit operator approval.',
      mutated: false,
    });
    expect(body.result.structuredContent).not.toHaveProperty('snapshot');
  });

  it('returns the application message when the order is missing', async () => {
    const investigateOrder =
      vi.fn<(orderNumber: string) => Promise<InvestigateOrderResult>>();
    investigateOrder.mockResolvedValue({
      found: false,
      orderNumber: 'ORD-DEMO-1042',
      message: 'No order was found with this order number.',
      mutated: false,
    });

    const body = await callInvestigateOrderTool(investigateOrder);

    expect(body.result.structuredContent).toEqual({
      found: false,
      orderNumber: 'ORD-DEMO-1042',
      message: 'No order was found with this order number.',
      recommendedNextAction: 'Verify the order number and try again.',
      mutated: false,
    });
  });
});

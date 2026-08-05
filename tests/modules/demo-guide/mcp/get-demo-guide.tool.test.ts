import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { describe, expect, it, vi } from 'vitest';
import { registerGetDemoGuideTool } from '../../../../src/modules/demo-guide/mcp/get-demo-guide.tool.js';

describe('get_demo_guide tool', () => {
  it('returns validated text and structured guide output', async () => {
    const guide = {
      service: {
        name: 'service',
        version: '1.0.0',
        description: 'Description',
      },
      project: { author: 'Author', repositoryUrl: null },
      database: { reachable: false, message: 'Unavailable' },
      workflow: [{ step: 1, tool: 'investigate_order', purpose: 'Inspect' }],
      demoScenarios: [
        {
          id: 'eligible',
          orderNumber: 'ORD-DEMO-1043',
          title: 'Eligible',
          description: 'Description',
          expectedInvestigation: 'RECOVERY_ELIGIBLE',
          recommendedFlow: ['investigate_order'],
        },
      ],
      testingNotes: ['Mutable data'],
    };
    const getDemoGuide = vi.fn(async () => guide);
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'guide-test', version: '0.1.0' });
      registerGetDemoGuideTool(server, { getDemoGuide });
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
          params: { name: 'get_demo_guide', arguments: {} },
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

    if (!data) {
      throw new Error('MCP response did not contain a result');
    }

    const body = JSON.parse(data) as {
      result: {
        content: Array<{ text: string }>;
        structuredContent: Record<string, unknown>;
      };
    };
    expect(getDemoGuide).toHaveBeenCalledOnce();
    expect(body.result.structuredContent).toEqual(guide);
    expect(JSON.parse(body.result.content[0].text)).toEqual(guide);
  });
});

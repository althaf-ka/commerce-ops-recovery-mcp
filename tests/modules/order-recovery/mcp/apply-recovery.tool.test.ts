import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  ApplyRecovery,
  ApplyRecoveryResult,
} from '../../../../src/modules/order-recovery/application/apply-recovery.js';
import { registerApplyRecoveryTool } from '../../../../src/modules/order-recovery/mcp/apply-recovery.tool.js';

async function callApplyRecoveryTool(
  applyRecovery: ApplyRecovery,
  argumentsValue: Record<string, unknown>,
) {
  const handler = createMcpHandler(() => {
    const server = new McpServer({
      name: 'apply-recovery-tool-test',
      version: '0.1.0',
    });
    registerApplyRecoveryTool(server, { applyRecovery });
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
          name: 'apply_recovery',
          arguments: argumentsValue,
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
      content?: Array<{ text: string }>;
      structuredContent?: Record<string, unknown>;
    };
  };
}

function createSuccessResult(
  overrides: Partial<ApplyRecoveryResult> = {},
): ApplyRecoveryResult {
  return {
    applied: true,
    code: 'RECOVERY_APPLIED',
    planId: 'plan-123',
    orderNumber: 'ORD-DEMO-1042',
    orderVersion: 5,
    message: 'The approved recovery was applied successfully.',
    idempotentReplay: false,
    commerceStateChangedByThisInvocation: true,
    ...overrides,
  } as ApplyRecoveryResult;
}

describe('apply_recovery tool', () => {
  it('maps an unapproved request to the application boundary', async () => {
    const result: ApplyRecoveryResult = {
      applied: false,
      code: 'CONFIRMATION_REQUIRED',
      planId: 'plan-123',
      message:
        'Explicit approval is required before the recovery plan can be applied.',
      idempotentReplay: false,
      commerceStateChangedByThisInvocation: false,
    };
    const applyRecovery = vi.fn<ApplyRecovery>(async () => result);

    const body = await callApplyRecoveryTool(applyRecovery, {
      planId: 'plan-123',
      approved: false,
    });

    expect(applyRecovery).toHaveBeenCalledWith({
      planId: 'plan-123',
      approved: false,
    });
    expect(body.result.structuredContent).toEqual(result);
  });

  it('passes trimmed approved input and returns text and structured output', async () => {
    const result = createSuccessResult();
    const applyRecovery = vi.fn<ApplyRecovery>(async () => result);

    const body = await callApplyRecoveryTool(applyRecovery, {
      planId: '  plan-123  ',
      approved: true,
      idempotencyKey: '  request-001  ',
    });

    expect(applyRecovery).toHaveBeenCalledWith({
      planId: 'plan-123',
      approved: true,
      idempotencyKey: 'request-001',
    });
    expect(body.result.structuredContent).toEqual(result);
    expect(JSON.parse(body.result.content?.[0].text ?? '')).toEqual(result);
  });

  it('preserves successful replay metadata', async () => {
    const result = createSuccessResult({
      idempotentReplay: true,
      commerceStateChangedByThisInvocation: false,
    });
    const applyRecovery = vi.fn<ApplyRecovery>(async () => result);

    const body = await callApplyRecoveryTool(applyRecovery, {
      planId: 'plan-123',
      approved: true,
      idempotencyKey: 'request-001',
    });

    expect(body.result.structuredContent).toMatchObject({
      idempotentReplay: true,
      commerceStateChangedByThisInvocation: false,
    });
  });

  it('returns expected domain failures as normal tool results', async () => {
    const result: ApplyRecoveryResult = {
      applied: false,
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      planId: 'plan-123',
      message: 'The idempotency key was already used for a different request.',
      idempotentReplay: false,
      commerceStateChangedByThisInvocation: false,
    };
    const applyRecovery = vi.fn<ApplyRecovery>(async () => result);

    const body = await callApplyRecoveryTool(applyRecovery, {
      planId: 'plan-123',
      approved: true,
      idempotencyKey: 'request-001',
    });

    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent).toEqual(result);
  });

  it('rejects approved input without an idempotency key', async () => {
    const applyRecovery = vi.fn<ApplyRecovery>();

    const body = await callApplyRecoveryTool(applyRecovery, {
      planId: 'plan-123',
      approved: true,
    });

    expect(body.result.isError).toBe(true);
    expect(applyRecovery).not.toHaveBeenCalled();
  });

  it('rejects malformed application output at the MCP boundary', async () => {
    const applyRecovery = vi.fn<ApplyRecovery>(async () =>
      Promise.resolve({
        applied: true,
        code: 'RECOVERY_APPLIED',
      } as unknown as ApplyRecoveryResult),
    );

    const body = await callApplyRecoveryTool(applyRecovery, {
      planId: 'plan-123',
      approved: true,
      idempotencyKey: 'request-001',
    });

    expect(applyRecovery).toHaveBeenCalledOnce();
    expect(body.result.isError).toBe(true);
  });
});

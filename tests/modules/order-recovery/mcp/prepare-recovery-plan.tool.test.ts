import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { describe, expect, it, vi } from 'vitest';
import { PrepareRecoveryPlanError } from '../../../../src/modules/order-recovery/application/prepare-recovery-plan.js';
import type { RecoveryPlan } from '../../../../src/modules/order-recovery/domain/recovery-plan.js';
import {
  type PrepareRecoveryPlan,
  registerPrepareRecoveryPlanTool,
} from '../../../../src/modules/order-recovery/mcp/prepare-recovery-plan.tool.js';

async function callPrepareRecoveryPlanTool(
  prepareRecoveryPlan: PrepareRecoveryPlan,
) {
  const handler = createMcpHandler(() => {
    const server = new McpServer({
      name: 'prepare-recovery-plan-tool-test',
      version: '0.1.0',
    });
    registerPrepareRecoveryPlanTool(server, prepareRecoveryPlan);
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
          name: 'prepare_recovery_plan',
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
      content: Array<{ text: string }>;
      structuredContent?: Record<string, unknown>;
    };
  };
}

function createPlan(): RecoveryPlan {
  return {
    id: 'plan-1',
    orderId: 'order-1',
    orderNumber: 'ORD-DEMO-1042',
    expectedOrderVersion: 3,
    status: 'pending',
    plannedChanges: {
      localPayment: { from: 'pending', to: 'paid' },
      order: {
        from: 'awaiting_payment',
        to: 'ready_for_fulfillment',
      },
      fulfillment: {
        from: 'blocked_awaiting_payment',
        to: 'ready_to_fulfill',
      },
      inventoryReservations: [
        { orderItemId: 'item-1', sku: 'SKU-DEMO', quantity: 2 },
      ],
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-01T00:15:00.000Z'),
    appliedAt: null,
    invalidatedReason: null,
  };
}

describe('prepare_recovery_plan tool', () => {
  it('returns the exact server-derived plan without commerce mutations', async () => {
    const plan = createPlan();
    const prepareRecoveryPlan = vi.fn(async () => ({
      plan,
      createdPlanRecord: true,
      reusedExistingPlan: false,
    }));

    const body = await callPrepareRecoveryPlanTool(prepareRecoveryPlan);

    expect(prepareRecoveryPlan).toHaveBeenCalledWith('ORD-DEMO-1042');
    expect(body.result.structuredContent).toEqual({
      planId: 'plan-1',
      orderNumber: 'ORD-DEMO-1042',
      expectedOrderVersion: 3,
      plannedChanges: plan.plannedChanges,
      expiresAt: '2026-01-01T00:15:00.000Z',
      status: 'pending',
      createdPlanRecord: true,
      reusedExistingPlan: false,
      approvalRequired: true,
      nextOperation: 'apply_recovery',
      nextAction:
        'Review the exact planned changes and obtain explicit operator approval before applying the recovery plan.',
      mutatedCommerceState: false,
    });
  });

  it('returns a stable application error for an ineligible order', async () => {
    const prepareRecoveryPlan = vi.fn<PrepareRecoveryPlan>();
    prepareRecoveryPlan.mockRejectedValue(
      new PrepareRecoveryPlanError(
        'RECOVERY_NOT_ELIGIBLE',
        'Internal application detail',
        {
          recoverable: false,
          reason: 'INSUFFICIENT_INVENTORY',
          evidence: ['SKU-DEMO: required 2, available 1'],
          recommendedEscalation: 'warehouse_operations',
        },
      ),
    );

    const body = await callPrepareRecoveryPlanTool(prepareRecoveryPlan);
    const error = JSON.parse(body.result.content[0].text) as unknown;

    expect(body.result.isError).toBe(true);
    expect(error).toEqual({
      error: 'RECOVERY_NOT_ELIGIBLE',
      message: 'The order is not eligible for recovery.',
      eligibility: {
        recoverable: false,
        reason: 'INSUFFICIENT_INVENTORY',
        evidence: ['SKU-DEMO: required 2, available 1'],
        recommendedEscalation: 'warehouse_operations',
      },
      mutatedCommerceState: false,
    });
  });
});

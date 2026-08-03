import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { InvestigateOrderResult } from '../application/investigate-order.js';
import type { RecoveryReason } from '../domain/recovery-policy.js';

export type InvestigateOrder = (
  orderNumber: string,
) => Promise<InvestigateOrderResult>;

type InvestigateOrderToolOutput =
  | {
      found: false;
      orderNumber: string;
      message: string;
      recommendedNextAction: string;
      mutated: false;
    }
  | {
      found: true;
      orderNumber: string;
      orderVersion: number;
      recoverable: boolean;
      reason: RecoveryReason;
      evidence: string[];
      recommendedEscalation?: string;
      recommendedNextAction: string;
      mutated: false;
    };

export function registerInvestigateOrderTool(
  server: McpServer,
  investigateOrder: InvestigateOrder,
): void {
  server.registerTool(
    'investigate_order',
    {
      title: 'Investigate order recovery',
      description: [
        'Investigate a synthetic commerce order using its order number.',
        'Returns payment, webhook, inventory, reservation and fulfillment evidence.',
        'Determines whether the order is eligible for the bounded local recovery workflow.',
        'This tool is read-only and never modifies commerce state.',
      ].join(' '),
      inputSchema: z.object({
        orderNumber: z
          .string()
          .trim()
          .min(1, 'Order number is required.')
          .max(64, 'Order number is too long.')
          .describe('Synthetic order number, for example ORD-DEMO-1042.'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ orderNumber }) => {
      try {
        const result = await investigateOrder(orderNumber);

        if (!result.found) {
          const output: InvestigateOrderToolOutput = {
            found: false,
            orderNumber: result.orderNumber,
            message: result.message,
            recommendedNextAction: 'Verify the order number and try again.',
            mutated: false,
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
            structuredContent: { ...output },
          };
        }

        const output: InvestigateOrderToolOutput = {
          found: true,
          orderNumber: result.orderNumber,
          orderVersion: result.orderVersion,
          recoverable: result.eligibility.recoverable,
          reason: result.eligibility.reason,
          evidence: result.eligibility.evidence,
          ...(result.eligibility.recommendedEscalation
            ? {
                recommendedEscalation: result.eligibility.recommendedEscalation,
              }
            : {}),
          recommendedNextAction: result.eligibility.recoverable
            ? 'Prepare a recovery plan for explicit operator approval.'
            : 'Do not mutate the order. Follow the returned reason and escalation guidance.',
          mutated: false,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: { ...output },
        };
      } catch (error) {
        console.error(
          JSON.stringify({
            event: 'investigate_order_tool_failed',
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : { name: 'UnknownError' },
          }),
        );

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'ORDER_INVESTIGATION_FAILED',
                  message:
                    'The order could not be investigated because of an internal error.',
                  mutated: false,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );
}

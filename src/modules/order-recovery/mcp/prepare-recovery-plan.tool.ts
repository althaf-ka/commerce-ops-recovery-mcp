import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  PrepareRecoveryPlanError,
  type PrepareRecoveryPlanErrorCode,
  type PrepareRecoveryPlanResult,
} from '../application/prepare-recovery-plan.js';
import type { RecoveryPlan } from '../domain/recovery-plan.js';

export type PrepareRecoveryPlan = (
  orderNumber: string,
) => Promise<PrepareRecoveryPlanResult>;

interface PrepareRecoveryPlanToolOutput {
  planId: string;
  orderNumber: string;
  expectedOrderVersion: number;
  plannedChanges: RecoveryPlan['plannedChanges'];
  expiresAt: string;
  status: RecoveryPlan['status'];
  createdPlanRecord: boolean;
  reusedExistingPlan: boolean;
  approvalRequired: true;
  nextOperation: 'apply_recovery';
  nextAction: string;
  mutatedCommerceState: false;
}

function getErrorMessage(code: PrepareRecoveryPlanErrorCode): string {
  return code === 'ORDER_NOT_FOUND'
    ? 'No order was found with this order number.'
    : 'The order is not eligible for recovery.';
}

export function registerPrepareRecoveryPlanTool(
  server: McpServer,
  prepareRecoveryPlan: PrepareRecoveryPlan,
): void {
  server.registerTool(
    'prepare_recovery_plan',
    {
      title: 'Prepare order recovery plan',
      description: [
        'Prepare a bounded recovery plan for an eligible synthetic commerce order.',
        'The server derives all planned changes from a fresh order snapshot.',
        'This creates a recovery plan record but does not mutate commerce state.',
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
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ orderNumber }) => {
      try {
        const result = await prepareRecoveryPlan(orderNumber);
        const plan = result.plan;
        const output: PrepareRecoveryPlanToolOutput = {
          planId: plan.id,
          orderNumber: plan.orderNumber,
          expectedOrderVersion: plan.expectedOrderVersion,
          plannedChanges: plan.plannedChanges,
          expiresAt: plan.expiresAt.toISOString(),
          status: plan.status,
          createdPlanRecord: result.createdPlanRecord,
          reusedExistingPlan: result.reusedExistingPlan,
          approvalRequired: true,
          nextOperation: 'apply_recovery',
          nextAction:
            'Review the exact planned changes and obtain explicit operator approval before applying the recovery plan.',
          mutatedCommerceState: false,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (error) {
        if (error instanceof PrepareRecoveryPlanError) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: error.code,
                    message: getErrorMessage(error.code),
                    ...(error.eligibility
                      ? { eligibility: error.eligibility }
                      : {}),
                    mutatedCommerceState: false,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        console.error(
          JSON.stringify({
            event: 'prepare_recovery_plan_tool_failed',
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
                  error: 'RECOVERY_PLAN_PREPARATION_FAILED',
                  message:
                    'The recovery plan could not be prepared because of an internal error.',
                  mutatedCommerceState: false,
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

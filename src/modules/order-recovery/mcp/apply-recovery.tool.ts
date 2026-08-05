import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  APPLY_RECOVERY_RESULT_CODES,
  type ApplyRecovery,
  type ApplyRecoveryInput,
} from '../application/apply-recovery.js';

export const applyRecoveryInputSchema = z
  .object({
    planId: z
      .string()
      .trim()
      .min(1, 'Recovery plan ID is required.')
      .describe('The recovery plan ID returned by prepare_recovery_plan.'),
    approved: z
      .boolean()
      .describe(
        'Must be true only after the operator explicitly approves the exact planned changes.',
      ),
    idempotencyKey: z
      .string()
      .trim()
      .min(1, 'Idempotency key must not be empty.')
      .max(200, 'Idempotency key must not exceed 200 characters.')
      .optional()
      .describe(
        'A unique caller-generated key. Reuse the same key only when retrying the same approved plan application.',
      ),
  })
  .superRefine((input, context) => {
    if (input.approved && !input.idempotencyKey?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['idempotencyKey'],
        message: 'idempotencyKey is required when approved is true.',
      });
    }
  });

export const applyRecoveryOutputSchema = z.object({
  applied: z.boolean(),
  code: z.enum(APPLY_RECOVERY_RESULT_CODES),
  planId: z.string(),
  orderNumber: z.string().optional(),
  orderVersion: z.number().int().nonnegative().optional(),
  message: z.string(),
  idempotentReplay: z.boolean(),
  commerceStateChangedByThisInvocation: z.boolean(),
});

export interface RegisterApplyRecoveryToolOptions {
  applyRecovery: ApplyRecovery;
}

export function registerApplyRecoveryTool(
  server: McpServer,
  options: RegisterApplyRecoveryToolOptions,
): void {
  server.registerTool(
    'apply_recovery',
    {
      title: 'Apply Recovery Plan',
      description:
        'Apply one previously prepared order-recovery plan. The tool changes commerce state only when approved is true and the current locked database state still exactly matches the approved plan. Reuse the same idempotency key only when retrying the same application request.',
      inputSchema: applyRecoveryInputSchema,
      outputSchema: applyRecoveryOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      let applicationInput: ApplyRecoveryInput;

      if (input.approved) {
        if (!input.idempotencyKey) {
          throw new Error(
            'Validated approved input is missing its idempotency key.',
          );
        }

        applicationInput = {
          planId: input.planId,
          approved: true,
          idempotencyKey: input.idempotencyKey,
        };
      } else {
        applicationInput = {
          planId: input.planId,
          approved: false,
        };
      }

      const result = await options.applyRecovery(applicationInput);
      const output = applyRecoveryOutputSchema.parse(result);

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );
}

export type ApplyRecoveryInput =
  | {
      planId: string;
      approved: false;
    }
  | {
      planId: string;
      approved: true;
      idempotencyKey: string;
    };

export const APPLY_RECOVERY_RESULT_CODES = [
  'CONFIRMATION_REQUIRED',
  'RECOVERY_APPLIED',
  'IDEMPOTENCY_KEY_CONFLICT',
  'PLAN_NOT_FOUND',
  'PLAN_ALREADY_APPLIED',
  'PLAN_NOT_PENDING',
  'PLAN_EXPIRED',
  'STALE_ORDER_VERSION',
  'RECOVERY_NOT_ELIGIBLE',
  'PLANNED_CHANGES_MISMATCH',
  'INSUFFICIENT_INVENTORY',
] as const;

export type ApplyRecoveryResultCode =
  (typeof APPLY_RECOVERY_RESULT_CODES)[number];

export type ApplyRecoveryFailureCode = Exclude<
  ApplyRecoveryResultCode,
  'CONFIRMATION_REQUIRED' | 'RECOVERY_APPLIED'
>;

export type ApplyRecoveryTransactionResult =
  | {
      applied: false;
      code: ApplyRecoveryFailureCode;
      planId: string;
      message: string;
      idempotentReplay: false;
      commerceStateChangedByThisInvocation: false;
    }
  | {
      applied: true;
      code: 'RECOVERY_APPLIED';
      planId: string;
      orderNumber: string;
      orderVersion: number;
      message: string;
      idempotentReplay: boolean;
      commerceStateChangedByThisInvocation: boolean;
    };

export type ApplyRecoveryResult =
  | {
      applied: false;
      code: 'CONFIRMATION_REQUIRED';
      planId: string;
      message: string;
      idempotentReplay: false;
      commerceStateChangedByThisInvocation: false;
    }
  | ApplyRecoveryTransactionResult;

export interface ApplyRecoveryTransactionInput {
  planId: string;
  idempotencyKey: string;
  requestHash: string;
  now: Date;
}

export interface ApplyRecoveryRepository {
  applyRecoveryTransaction(
    input: ApplyRecoveryTransactionInput,
  ): Promise<ApplyRecoveryTransactionResult>;
}

export interface ApplyRecoveryOptions {
  now?: () => Date;
  createRequestHash?: (planId: string) => Promise<string>;
}

async function createDefaultRequestHash(planId: string): Promise<string> {
  const request = JSON.stringify({
    operation: 'apply_recovery',
    planId,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(request),
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function createApplyRecovery(
  repository: ApplyRecoveryRepository,
  options: ApplyRecoveryOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const createRequestHash =
    options.createRequestHash ?? createDefaultRequestHash;

  return async function applyRecovery(
    input: ApplyRecoveryInput,
  ): Promise<ApplyRecoveryResult> {
    if (!input.approved) {
      return {
        applied: false,
        code: 'CONFIRMATION_REQUIRED',
        planId: input.planId,
        message:
          'Explicit approval is required before the recovery plan can be applied.',
        idempotentReplay: false,
        commerceStateChangedByThisInvocation: false,
      };
    }

    const idempotencyKey = input.idempotencyKey.trim();

    if (idempotencyKey.length === 0) {
      throw new TypeError('Idempotency key must not be empty.');
    }

    const requestHash = await createRequestHash(input.planId);

    return repository.applyRecoveryTransaction({
      planId: input.planId,
      idempotencyKey,
      requestHash,
      now: now(),
    });
  };
}

export type ApplyRecovery = ReturnType<typeof createApplyRecovery>;

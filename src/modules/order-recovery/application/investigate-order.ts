import type { OrderSnapshot } from '../domain/order-snapshot.js';
import {
  evaluateRecoveryEligibility,
  type RecoveryEligibilityResult,
} from '../domain/recovery-policy.js';

export interface InvestigateOrderDependencies {
  getOrderSnapshot(orderNumber: string): Promise<OrderSnapshot | null>;
}

export type InvestigateOrderResult =
  | {
      found: false;
      orderNumber: string;
      message: string;
      mutated: false;
    }
  | {
      found: true;
      orderNumber: string;
      orderVersion: number;
      snapshot: OrderSnapshot;
      eligibility: RecoveryEligibilityResult;
      mutated: false;
    };

export function createInvestigateOrder(
  dependencies: InvestigateOrderDependencies,
) {
  return async function investigateOrder(
    orderNumber: string,
  ): Promise<InvestigateOrderResult> {
    const snapshot = await dependencies.getOrderSnapshot(orderNumber);

    if (!snapshot) {
      return {
        found: false,
        orderNumber,
        message: 'No order was found with this order number.',
        mutated: false,
      };
    }

    const eligibility = evaluateRecoveryEligibility(snapshot);

    return {
      found: true,
      orderNumber: snapshot.order.orderNumber,
      orderVersion: snapshot.order.version,
      snapshot,
      eligibility,
      mutated: false,
    };
  };
}

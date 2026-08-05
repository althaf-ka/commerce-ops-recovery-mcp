export const DEMO_SCENARIOS = [
  {
    id: 'already_recovered',
    orderNumber: 'ORD-DEMO-1042',
    title: 'Already recovered',
    description:
      'Demonstrates that the server detects a completed recovery and refuses further mutation.',
    expectedInvestigation: 'ALREADY_RECOVERED',
    recommendedFlow: ['investigate_order'],
  },
  {
    id: 'eligible_primary',
    orderNumber: 'ORD-DEMO-1043',
    title: 'Eligible recovery',
    description:
      'Primary scenario for the complete investigate, prepare, approve and apply workflow.',
    expectedInvestigation: 'RECOVERY_ELIGIBLE',
    recommendedFlow: [
      'investigate_order',
      'prepare_recovery_plan',
      'apply_recovery',
    ],
  },
  {
    id: 'eligible_backup',
    orderNumber: 'ORD-DEMO-1044',
    title: 'Eligible recovery backup',
    description:
      'A second eligible scenario in case the primary demo order has already been recovered.',
    expectedInvestigation: 'RECOVERY_ELIGIBLE',
    recommendedFlow: [
      'investigate_order',
      'prepare_recovery_plan',
      'apply_recovery',
    ],
  },
  {
    id: 'insufficient_inventory',
    orderNumber: 'ORD-DEMO-1045',
    title: 'Insufficient inventory',
    description:
      'Demonstrates that recovery is rejected when the required inventory is unavailable.',
    expectedInvestigation: 'INSUFFICIENT_INVENTORY',
    recommendedFlow: ['investigate_order'],
  },
] as const;

export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

export const DEMO_ORDER_NUMBERS = DEMO_SCENARIOS.map(
  ({ orderNumber }) => orderNumber,
);

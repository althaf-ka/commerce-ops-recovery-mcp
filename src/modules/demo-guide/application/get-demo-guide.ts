import { SERVICE_METADATA } from '../../../config/service-metadata.js';
import { DEMO_SCENARIOS } from '../../../demo/demo-scenarios.js';

export interface GetDemoGuideDependencies {
  repositoryUrl?: string;
  checkDatabaseConnectivity: () => Promise<void>;
}

export function createGetDemoGuide(dependencies: GetDemoGuideDependencies) {
  return async function getDemoGuide() {
    let database: { reachable: boolean; message: string };

    try {
      await dependencies.checkDatabaseConnectivity();
      database = {
        reachable: true,
        message: 'PostgreSQL is reachable and ready for demo requests.',
      };
    } catch {
      database = {
        reachable: false,
        message:
          'PostgreSQL is currently unavailable. Check the database connection, Hyperdrive configuration and migrations.',
      };
    }

    return {
      service: {
        name: SERVICE_METADATA.name,
        version: SERVICE_METADATA.version,
        description: SERVICE_METADATA.description,
      },
      project: {
        author: SERVICE_METADATA.author,
        repositoryUrl: dependencies.repositoryUrl?.trim() || null,
      },
      database,
      workflow: [
        {
          step: 1,
          tool: 'investigate_order',
          purpose:
            'Inspect the current order, payment, webhook, inventory and fulfillment state without mutation.',
        },
        {
          step: 2,
          tool: 'prepare_recovery_plan',
          purpose:
            'Create or reuse an expiring plan containing the exact proposed recovery changes.',
        },
        {
          step: 3,
          tool: 'apply_recovery',
          purpose:
            'Apply an explicitly approved plan using one atomic PostgreSQL transaction.',
        },
      ],
      demoScenarios: DEMO_SCENARIOS,
      testingNotes: [
        'Demo orders are mutable. Always call investigate_order before preparing a recovery.',
        'A successfully recovered eligible order will later report ALREADY_RECOVERED.',
        'approved: false performs no commerce mutation.',
        'approved: true requires an idempotency key.',
        'Reuse the same idempotency key only when retrying the same apply request.',
        'Run the developer-only demo reset script locally to restore the seeded scenarios.',
        'The project uses synthetic commerce data and does not contact a real payment processor or fulfillment provider.',
      ],
    };
  };
}

export type GetDemoGuide = ReturnType<typeof createGetDemoGuide>;

import { describe, expect, it, vi } from 'vitest';
import { DEMO_SCENARIOS } from '../../../../src/demo/demo-scenarios.js';
import { createGetDemoGuide } from '../../../../src/modules/demo-guide/application/get-demo-guide.js';

describe('getDemoGuide', () => {
  it('returns project, workflow, scenarios and reachable database status', async () => {
    const checkDatabaseConnectivity = vi.fn(async () => undefined);
    const getDemoGuide = createGetDemoGuide({
      repositoryUrl: 'https://github.com/example/project',
      checkDatabaseConnectivity,
    });

    const result = await getDemoGuide();

    expect(checkDatabaseConnectivity).toHaveBeenCalledOnce();
    expect(result.database.reachable).toBe(true);
    expect(result.project.repositoryUrl).toBe(
      'https://github.com/example/project',
    );
    expect(result.demoScenarios).toBe(DEMO_SCENARIOS);
    expect(result.workflow.map(({ tool }) => tool)).toEqual([
      'investigate_order',
      'prepare_recovery_plan',
      'apply_recovery',
    ]);
  });

  it('still returns the guide when database connectivity fails', async () => {
    const getDemoGuide = createGetDemoGuide({
      checkDatabaseConnectivity: vi.fn(async () => {
        throw new Error('Sensitive connection detail');
      }),
    });

    const result = await getDemoGuide();

    expect(result.database).toEqual({
      reachable: false,
      message:
        'PostgreSQL is currently unavailable. Check the database connection, Hyperdrive configuration and migrations.',
    });
    expect(result.project.repositoryUrl).toBeNull();
    expect(JSON.stringify(result)).not.toContain('Sensitive connection detail');
  });
});

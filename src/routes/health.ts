import { Hono } from 'hono';
import { checkDatabaseConnectivity } from '../db/connectivity.js';
import type { AppEnv } from '../env.js';

export const healthRoutes = new Hono<AppEnv>()
  .get('/', (c) =>
    c.json({
      status: 'ok',
      service: 'commerce-ops-recovery-mcp',
      version: '0.1.0',
    }),
  )
  .get('/database', async (c) => {
    try {
      const connected = await checkDatabaseConnectivity(c.env);

      return c.json({
        status: 'ok',
        connected,
      });
    } catch (error) {
      console.error({
        event: 'database_connectivity_check_failed',
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
              }
            : {
                name: 'UnknownError',
              },
      });

      return c.json(
        {
          status: 'error',
          connected: false,
        },
        503,
      );
    }
  });

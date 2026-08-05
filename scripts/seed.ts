import { withScriptDatabase } from './lib/database.js';
import {
  DemoSeedConflictError,
  seedDemoScenarios,
} from './lib/seed-demo-scenarios.js';

try {
  const created = await withScriptDatabase((database) =>
    database.transaction((tx) => seedDemoScenarios(tx)),
  );

  process.stdout.write(
    created
      ? 'Created four demo scenarios.\n'
      : 'All four demo scenarios already exist; no data was changed.\n',
  );
} catch (error) {
  if (!(error instanceof DemoSeedConflictError)) {
    throw error;
  }

  process.stderr.write(
    [
      'Demo seed was not changed.',
      `Reason: ${error.message}`,
      'Next step: run `pnpm db:reset-demo` to deliberately restore the known demo scenarios.',
      '',
    ].join('\n'),
  );
  process.exitCode = 1;
}

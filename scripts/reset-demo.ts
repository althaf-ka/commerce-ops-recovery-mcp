import { withScriptDatabase } from './lib/database.js';
import {
  removeDemoScenarios,
  seedDemoScenarios,
} from './lib/seed-demo-scenarios.js';

await withScriptDatabase((database) =>
  database.transaction(async (tx) => {
    await removeDemoScenarios(tx);
    await seedDemoScenarios(tx);
  }),
);

process.stdout.write('Reset four known demo scenarios.\n');

import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

const demoScenarioSchema = z.object({
  id: z.string(),
  orderNumber: z.string(),
  title: z.string(),
  description: z.string(),
  expectedInvestigation: z.string(),
  recommendedFlow: z.array(z.string()),
});

export const getDemoGuideOutputSchema = z.object({
  service: z.object({
    name: z.string(),
    version: z.string(),
    description: z.string(),
  }),
  project: z.object({
    author: z.string(),
    repositoryUrl: z.url().nullable(),
  }),
  database: z.object({
    reachable: z.boolean(),
    message: z.string(),
  }),
  workflow: z.array(
    z.object({
      step: z.number().int(),
      tool: z.string(),
      purpose: z.string(),
    }),
  ),
  demoScenarios: z.array(demoScenarioSchema),
  testingNotes: z.array(z.string()),
});

export function registerGetDemoGuideTool(
  server: McpServer,
  options: { getDemoGuide: () => Promise<unknown> },
): void {
  server.registerTool(
    'get_demo_guide',
    {
      title: 'Get Demo Guide',
      description:
        'Show the recovery workflow, seeded test scenarios, project repository and current database availability.',
      inputSchema: z.object({}),
      outputSchema: getDemoGuideOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const output = getDemoGuideOutputSchema.parse(
        await options.getDemoGuide(),
      );

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );
}

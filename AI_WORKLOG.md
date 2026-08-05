# AI Worklog

## Tools used

- **ChatGPT GPT-5.6 Thinking** — planning, architecture, tradeoffs, and safety
  review.
- **OpenCode with DeepSeek V4** — implementation, debugging, refactoring, and
  tests.

I used the stronger reasoning model for decisions around the MCP workflow,
recovery boundary, approval, transactions, idempotency, and concurrency.
DeepSeek V4 was mainly used for faster coding work inside the existing project.

## How I used AI

AI helped me break down the problem, discuss unfamiliar backend concepts,
review implementation choices, and identify important failure and test cases.

I provided the project constraints, current code structure, database schema,
approved recovery boundary, and test results throughout the process.

## My responsibility

I made the final technical decisions, reviewed and adapted generated code,
tested the MCP tools, and checked database behavior.

One suggestion I changed was storing an additional idempotency key on the
recovery plan. I kept the caller-provided key and stored the idempotency result
separately instead.

## Verification

I verified the work through TypeScript checks, automated tests, Biome, schema
verification, MCP Inspector, and direct database-state checks.

## Remaining scope

The project uses synthetic data and does not call real payment or fulfillment
providers. Operator authentication is outside the assignment scope.

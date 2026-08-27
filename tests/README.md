# Tests

Zero-dependency: Node's built-in test runner over TypeScript compiled by `tsc`.

```bash
npm test
```

## Why the symlink step

`tsc` does not rewrite path aliases in its output, so compiled code still emits
`require("@/lib/...")`. The pretest step creates
`.test-build/node_modules/@/lib -> .test-build/lib`, which lets Node's ordinary
`node_modules` resolution handle the alias. This avoids adding a loader,
`tsconfig-paths`, `tsx`, `jest`, or `vitest` — the project's no-new-dependency
rule applies to devDependencies too.

## What is covered

Pure logic that would be expensive to get wrong and silent when it breaks:
the trading calendar, indicator maths, Flex statement parsing, the brief
validation gates, scoring maths, and email rendering.

Not covered: anything requiring network or database access. Those paths are
verified against the live services via `/api/preflight` and the runbook in the
README.

# Loop 001

**Library:** libs/workflow
**Date:** 2026-07-17

## Goal

First `ci.loop` pass over `libs/workflow`, the largest and most complex of
the four shared libraries (durable workflow/saga engine, published
separately as `@ows4444/nest-workflow`). Delegated initial Phase 1/2 reading
to a research subagent given the library's size, then independently
verified every finding against the source before acting on it.

## Files Reviewed

All of `libs/workflow/src/**/*.ts` (engine: executor/runner/step-executor,
compensation, retry/auto-recovery, signals, state machine, child-workflow,
lifecycle, hooks, expiration; persistence: TypeORM adapters/entities/
migrations and the database-backed adapter; ports; public API surface
`public/api/*` and `index.ts`), plus `libs/database`'s
`TransactionExecutor` (to verify rollback-on-throw semantics before deciding
on the signal-store finding).

## Problems Found

**Critical**
- `WorkflowSignalEntity.signalId` was the sole `@PrimaryColumn` —
  caller-supplied via `WorkflowClient.signal()` and only meant to be unique
  within one workflow, but the schema made it globally unique across *all*
  workflows. `WorkflowSignalProcessor.prepareInternal` also discarded
  `WorkflowSignalService.append()`'s return value, so when a second workflow
  reused the same `signalId` (e.g. `"approve"`), its insert silently failed
  against the duplicate key while its state machine still advanced as if
  the signal landed — and `complete()`/`markProcessed()`/`load()`/`exists()`
  all keyed off `signalId` alone, so one workflow's calls could load/mark
  a *different* workflow's row. Same class of bug as the `RMQPublisher`
  fix from the `libs/queue` loop (reused caller id as sole correlation key).

**High**
- (Investigated, not applicable) `WorkflowModule.forRootAsync` — initially
  flagged as missing like `libs/queue`/`cache`/`database`, but on closer
  inspection `WorkflowModuleOptions.metrics`/`.eventPublisher` already
  accept raw Nest `Provider` objects (`useFactory`/`inject` work today, and
  `ConfigModule` is global in this app), so ConfigService-based resolution
  already works without `forRootAsync`. The one option that can't be made
  async is `persistence` — it selects which module gets imported
  (`WorkflowPersistenceModule` vs `WorkflowDatabasePersistenceModule`),
  which Nest can't resolve from a runtime factory. User chose to skip this
  rather than add speculative API surface with no functional gap behind it.

**Medium**
- `WorkflowExpirationService` was dead/orphaned: registered and exported
  from `WorkflowModule` but never called anywhere, and not exported from
  the public `index.ts` barrel either (so external consumers couldn't
  reach it without violating the barrel-only import rule).
  `WorkflowAutoRecoveryService.recover()` already implements equivalent
  (and more complete — stuck-detection and retryable-recovery too)
  expired-waiting cancellation via `WorkflowExecutor.cancel()`. Same shape
  as the dead `QueueService` found in the `libs/queue` loop.
- `WorkflowCompensationService.compensateSteps` swallowed per-step handler
  failures with only a log line; callers (`WorkflowFailureService`,
  `ChildWorkflowService`'s `compensate-parent` policy) had no way to know
  whether a saga rollback partially failed (e.g. an uncompensated payment
  capture), and the `compensate-parent` code path itself had zero test
  coverage before this loop.

**Low / coverage gap**
- Zero coverage on `delay.service.ts` (pure retry-delay math) and
  `workflow-idempotency-key.ts` (pure key-building util) — both cheap to
  test and directly relevant to this loop's fixes.
- Broader coverage gaps remain on `step-persistence.ts` (state+history+
  snapshot atomicity — the core write path), `auto-recovery.service.ts`
  (the entire crash-recovery sweep), `hook-executor.ts`,
  `definition.validator.ts`/`step-result.validator.ts`, `history.service.ts`,
  `workflow-persistence.service.ts`, `retention.service.ts` — not addressed
  this loop, see Next Loop.

## Changes Made

- **Signal-id collision (Critical):**
  - `WorkflowSignalEntity`: composite primary key `(workflowId, signalId)`.
  - New migration `WorkflowSignalCompositeKey1752200000000` (MySQL
    `DROP PRIMARY KEY` / `ADD PRIMARY KEY`), registered in
    `WORKFLOW_MIGRATIONS` and exported from `index.ts`.
  - `WorkflowSignalStore` port, `TypeOrmWorkflowSignalStore`, and
    `WorkflowSignalService`: `load`/`exists`/`markProcessed` now take
    `(workflowId, signalId)` instead of `signalId` alone.
  - `WorkflowSignalProcessor.complete()` threads `workflowId` through to the
    now-scoped `load`/`markProcessed` calls.
  - `WorkflowSignalProcessor.prepareInternal` no longer discards
    `append()`'s return value — a duplicate-key hit (now only reachable via
    a genuine same-workflow race, since cross-workflow collisions are fixed
    by the composite key) is logged and treated as already-recorded rather
    than silently proceeding to resume the workflow.
  - Regression tests: two workflows reusing the same `signalId` no longer
    collide on insert or `markProcessed`; `WorkflowSignalProcessor` returns
    `acquired: false` without resuming when a duplicate row is hit.

- **`WorkflowExpirationService` (Medium):** deleted (`engine/expiration/`
  directory and its spec) along with its `WorkflowModule` provider/export
  wiring — `WorkflowAutoRecoveryService` already covers this behavior.

- **Compensation failures (Medium):**
  - `WorkflowMetrics` gained an optional `compensationFailed?(workflowName,
    step)` method (optional so existing external implementations keep
    compiling); implemented as a no-op in `NoopWorkflowMetricsService`.
  - `WorkflowCompensationService.compensate()` now returns
    `Promise<CompensationOutcome>` (`boolean`: `true` iff every step's
    compensation handler succeeded) instead of `Promise<void>`, and calls
    `metrics.compensationFailed?.()` per failed step. `WorkflowCompensationService`
    is internal-only (not exported from `index.ts`), so this signature
    change doesn't touch the public API.
  - `WorkflowFailureService.failExecution` and
    `ChildWorkflowService.onChildFailed`'s `compensate-parent` branch both
    now log an explicit "did not fully complete... requires manual
    intervention" error when compensation reports partial failure.
  - Added the first tests for the previously-uncovered `compensate-parent`
    policy branch (3 new tests), plus tests for the new return-value
    contract on `WorkflowCompensationService`.

- Added `delay.service.spec.ts` and `workflow-idempotency-key.spec.ts`.

## Why

- User approved the full scope ("everything incl. the migration") after
  reviewing the signal-id collision finding and its schema/migration
  impact — the highest-value fix this loop, reachable via the public
  `WorkflowClient.signal()` API with realistic caller behavior (any
  client-chosen signalId, not just UUIDs).
- The `forRootAsync` finding was dropped after implementation-level
  investigation showed the premise didn't hold — Section 17's "every
  refactor must have measurable value" argues against adding it anyway.
- Compensation-failure visibility was implemented via an *optional*
  interface method and an internal-only return-value change specifically
  to avoid a breaking public-API change, per Section 17's backward-
  compatibility rule.

## Tests

`libs/workflow` suite is now 33 spec files / 246 tests (up from 32 files /
236 tests — net change reflects the deleted `workflow-expiration.service.spec.ts`
offset by new signal-store, signal-processor, compensation, child-workflow,
delay-service, and idempotency-key tests). Full monorepo suite: 87 suites /
646 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` exists for this library yet; this loop was pure Improvement
  Loop (Sections 1-19), no Design Mode session preceded it.
- Broader test-coverage gaps noted above (`step-persistence.ts`,
  `auto-recovery.service.ts`, `hook-executor.ts`, validators,
  `history.service.ts`, `workflow-persistence.service.ts`,
  `retention.service.ts`) — not started.
- Deployments with existing `workflow_signals` data should confirm no
  pre-existing cross-workflow `signalId` collisions exist before running
  the new migration (a collision would mean two rows already share a
  `signalId` with different `workflowId`s — the migration itself doesn't
  need to dedup since the old PK already guaranteed at most one row per
  `signalId`, but it's worth a sanity check in any environment with
  meaningful production signal history).

## Next Loop

- Prioritize `step-persistence.ts` and `auto-recovery.service.ts` for test
  coverage — both encode business-critical atomicity/scheduling decisions
  with zero current coverage.
- Consider whether `WorkflowCompensationService`'s new `CompensationOutcome`
  boolean should eventually carry which steps failed (not just whether
  everything succeeded) if a consumer ever needs to retry specific
  compensation steps rather than requiring full manual intervention.
- No further Critical/High findings identified this pass beyond what's
  listed above as remaining coverage gaps (Low severity). Per Section 16,
  this library is close to a natural stopping point once the
  `step-persistence.ts`/`auto-recovery.service.ts` coverage gap is closed.

# Loop 002

**Library:** libs/workflow
**Date:** 2026-07-17

## Goal

Close the two highest-priority test-coverage gaps flagged in Loop 001's
Next Loop notes: `step-persistence.ts` (core write-path atomicity) and
`auto-recovery.service.ts` (the crash-recovery sweep) — both at zero
coverage despite encoding business-critical logic.

## Files Reviewed

- `engine/executor/step-persistence.ts`
- `engine/retry/auto-recovery.service.ts`
- `engine/retry/recovery.service.ts`, `engine/registry/registry.ts` (to
  build accurate mocks/fixtures)
- While writing the auto-recovery test, a real bug surfaced (see below),
  which prompted a repo-wide sweep of every `setInterval`/`setTimeout` in
  `libs/workflow` for the same gap: `infrastructure/lease/lease.service.ts`,
  `engine/retry/default-scheduler.service.ts`,
  `engine/executor/step-executor.ts`, `engine/compensation/service.ts`,
  `retention/retention.service.ts`.

## Problems Found

**Medium**
- `WorkflowAutoRecoveryService.onModuleInit`'s sweep `setInterval` was never
  `.unref()`'d, unlike the equivalent pattern already fixed in
  `libs/queue`'s `OutboxDispatcherService`/`RMQConnection` during that
  library's loop. This isn't hypothetical: writing a straightforward test
  that called `onModuleInit()` and let the interval run past the test
  actually hung the Jest worker on a leaked, ref'd timer — the same failure
  mode this would cause in a real short-lived Node process (a script or
  worker that spins up the module and never explicitly calls `.close()`).
  The same gap was found in five more places on inspection:
  `WorkflowRetentionService`'s cleanup sweep interval, and one-shot timers
  in `WorkflowLeaseService.keepAlive`, `DefaultWorkflowRetryScheduler.wait`,
  `WorkflowStepExecutor`'s per-step timeout, and
  `WorkflowCompensationService`'s per-step compensation timeout.
- (Not changed) `WorkflowLeaseService.onApplicationShutdown`'s shutdown-poll
  `setTimeout` was deliberately left un-refed as-is — unlike the others,
  it's a bounded poll-until-condition loop already running inside an
  explicit shutdown sequence, so unrefing it risks the process exiting
  before the poll's deadline/condition is ever re-checked.

## Changes Made

- Added `timer.unref()` / `timeout.unref()` at all six sites listed above
  (five sweep/wait timers fixed; the shutdown-poll timer deliberately left
  alone, see above).
- New spec files:
  - `step-persistence.spec.ts` (7 tests): transaction wrapping for
    `startStep`/`completeStep`/`recordRetryAttempt`, write-ordering
    (history append before state transition) for `completeStep`, and that
    `recordStepAttempt`/`appendFailure` deliberately bypass the transaction
    wrapper (single atomic write, no combined state save).
  - `auto-recovery.service.spec.ts` (13 tests): interval scheduling
    (default vs. smallest configured `autoResume.intervalMs`), the full
    `recover()` sweep across all three sub-sweeps (recoverable/stuck/
    expired-waiting) including per-item skip conditions (retryAt in future,
    autoResume disabled, maxAttempts exhausted, timeout not yet elapsed)
    and that one item's failure doesn't abort the rest of the sweep.
  - `delay.service.spec.ts` and `workflow-idempotency-key.spec.ts` (from
    Loop 001's leftover scope, folded in here).

## Why

- These two files were called out explicitly in Loop 001 as the top
  priority: `step-persistence.ts` is the atomicity boundary between state,
  history, and snapshot writes (get this wrong and you can silently lose
  audit trail or leave state/history inconsistent), and
  `auto-recovery.service.ts` is the entire crash-recovery sweep — the
  mechanism that makes the "durable" in "durable workflow engine" true.
  Both had zero coverage protecting them from regression.
- The `.unref()` fix wasn't planned — it was discovered because a real test
  exercising real behavior hung, which is exactly the value of writing the
  test in the first place. Extended to sibling timers per Section 17's
  "check whether a fix pattern... should be cross-checked" guidance and the
  cross-lib consistency principle (Section 1) — this exact pattern was
  fixed in `libs/queue` two loops ago, and `libs/workflow` has more
  standalone timers than that library did.

## Tests

`libs/workflow` suite is now 35 spec files / 266 tests (up from 33 files /
246 tests). Full monorepo suite: 89 suites / 666 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` exists for this library yet.
- Remaining coverage gaps from Loop 001 not addressed this loop:
  `hook-executor.ts`, `definition.validator.ts`/`step-result.validator.ts`,
  `history.service.ts`, `workflow-persistence.service.ts`,
  `retention.service.ts`.

## Next Loop

- Continue closing the remaining coverage gaps listed above, roughly in
  that priority order (validators and `history.service.ts` are the next
  most business-critical; `retention.service.ts` is lower-stakes cleanup
  logic).
- No Critical/High findings remain open. Per Section 16, `libs/workflow` is
  now at the same "no Critical/High open, tests/build/lint green" stopping
  point `libs/queue` reached — further loops are coverage/polish work
  rather than defect-driven.

# Loop 003

**Library:** libs/workflow
**Date:** 2026-07-17

## Goal

Close the remaining test-coverage gaps from Loop 002's Next Loop list:
`definition.validator.ts`, `step-result.validator.ts`, `history.service.ts`,
`workflow-persistence.service.ts`, `retention.service.ts`, and
`hook-executor.ts`.

## Files Reviewed

- `engine/validation/definition.validator.ts` (15 private validation rules
  across start-step, transitions, reachability, cycles, terminal-steps,
  retry policy, timeouts, signals, deprecated steps, child workflows,
  compensation, auto-resume, retention, persistence, and a cross-field
  compatibility check)
- `engine/validation/step-result.validator.ts`
- `persistence/history.service.ts`, `persistence/workflow-persistence.service.ts`
- `retention/retention.service.ts`, `engine/hooks/hook-executor.ts`

## Problems Found

**Low (dead code, discovered while writing tests)**
- `WorkflowDefinitionValidator.validateTerminalSteps`'s throw branch is
  unreachable in practice: a finite transition graph with zero terminal
  steps and zero cycles is mathematically impossible (following out-edges
  from any node must eventually revisit one), and `validateCycles` runs
  *before* `validateTerminalSteps` in `validate()`'s call order — so any
  graph that would trip the terminal-step check always trips the cycle
  check first instead. Not changed — this reads as an intentional
  belt-and-suspenders check rather than a bug, and removing defensive
  validation code without a clear win isn't justified by Section 17.
- `validateSignals`'s dedicated "Signal expiry would be effectively
  disabled" error message (for `signals.defaultTimeoutMs` exceeding the
  365-day maximum) is also unreachable: `validatePositiveDuration`, called
  a few lines earlier in the same method for the same field, already
  throws its own (more generic) "must be <= ...365 days" error for the
  exact same condition first. Also not changed this loop — same reasoning,
  but flagged here since unlike the terminal-steps case, this one directly
  means a more-specific, more-helpful error message never fires in favor
  of a less specific one, which is worth a deliberate cleanup decision
  rather than an incidental one.

## Changes Made

- New spec files, no production code changes this loop:
  - `definition.validator.spec.ts` (34 tests): one passing case per
    validation rule plus a representative failing case for each of the ~25
    distinct error conditions across all 15 validation methods.
  - `step-result.validator.spec.ts` (5 tests).
  - `history.service.spec.ts` (6 tests): covers both the store-configured
    path and the `@Optional()` no-store path (all three methods degrade to
    safe no-ops/empty-array rather than throwing when no
    `WORKFLOW_HISTORY_STORE` is bound).
  - `workflow-persistence.service.spec.ts` (11 tests): `shouldSnapshot`'s
    frequency/zero-historyCount edge cases, `snapshot`'s conditional write,
    and all four of `recoverSnapshot`'s staleness-rejection branches
    (missing, wrong workflow, older stateVersion, less history).
  - `retention.service.spec.ts` (8 tests): interval scheduling,
    skip-when-no-retention-configured, delete, archive-before-delete,
    per-item failure isolation, and that ttlMs/batchSize are threaded
    through to the store query correctly.
  - `hook-executor.spec.ts` (5 tests): no-hook no-op, `observability.audit:
    false` skip, missing-instance warning path, successful invocation, and
    that a throwing hook handler reports `metrics.hookFailed` without
    propagating.

## Why

- This was the last item on Loop 002's Next Loop list — closing it means
  every non-trivial file in `libs/workflow`'s engine/persistence/retention
  layers now has direct test coverage, matching the bar already met by
  `libs/queue`.
- The two dead-code findings were left alone rather than fixed: both are
  genuinely low-stakes (unreachable defensive code, not incorrect
  behavior), and per Section 17 "never refactor code that already
  satisfies correctness" — these don't cause wrong behavior, just a
  redundant/less-specific error message in one case. Recorded here so a
  future loop can make a deliberate call rather than rediscovering it.

## Tests

`libs/workflow` suite is now 41 spec files / 337 tests (up from 35 files /
266 tests). Full monorepo suite: 95 suites / 737 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` exists for this library yet.
- The two unreachable-branch observations above (terminal-steps check,
  duplicate signal-timeout message) — no action needed unless a future
  loop decides the redundant error message in `validateSignals` is worth
  cleaning up.
- No further systematic coverage gaps identified. Any remaining untested
  files at this point are either trivial (interfaces, DTOs, decorators
  already covered indirectly) or already covered.

## Next Loop

- No Critical/High findings open. `libs/workflow`'s three loops (bug fix +
  dead code removal → timer/shutdown hygiene → coverage completion) mirror
  the shape of `libs/queue`'s two loops. Both libraries are now at a
  genuine stopping point per Section 16 — further work would be either new
  findings from a fresh review pass, or moving to `libs/cache`/
  `libs/database`'s own deferred Next Loop items.

# Loop 001

**Library:** libs/database
**Date:** 2026-07-17

## Goal

First ci.loop pass over `libs/database`. No prior LOOP.md/ARCH.md existed. Full Phase 1 (Understand) read of all 51 source files + 10 spec files, followed by a ranked Phase 2 (Review), then Phase 3/4 (Plan/Implement) scoped to the user-selected High + Medium findings.

## Files Reviewed

- All files under `libs/database/src/**` (config, constants, database, datasource, decorators, health, interfaces, module, pagination, repository, transaction, utils) plus `index.ts`.

## Problems Found

**Critical**
- (none)

**High**
- Reader misattribution on connectivity-failure reporting/recovery: with 2+ configured readers, `DataSourceManager.reportFailure`/`waitForRecovery` re-ran round-robin selection independently of the reader `RepositoryResolver` actually used for the query, so a failure could be attributed to (and recovery awaited on) the wrong reader.
- Zero test coverage for `isDatabaseConnectivityError` (`utils/database-error.util.ts`), the single function deciding retry-vs-fail-fast for every DB operation in the lib.

**Medium**
- `DatabaseAccessor`/`InjectDatabase` were fully implemented, provider-registered, and unit-tested, but never exported from `DatabaseCoreModule` or the barrel — completely unreachable by consumers.
- `RepositoryRegistry`'s static, import-order-dependent registration was undocumented — a repository not statically reachable from the root module's import graph silently gets no DI providers.
- `BaseRepository`'s read-recovery timeout was hardcoded (`RECOVERY_TIMEOUT_MS = 2_000`, private static), inconsistent with `DataSourceManager`'s own retry/reconnect timing being driven by `ResolvedDatabaseOptions.retry`.
- `DataSourceManager.updateServerIdentity`'s asymmetric handling (reconnect on server-UUID change, log-only on read-only flag flip) was undocumented, unclear whether intentional.
- Missing test coverage for `RepositoryResolver`, `transaction.context.ts`, `pagination.util.ts`, and no test constructing `DatabaseModule.forRootAsync` end-to-end via `Test.createTestingModule`.

**Low** (out of scope this loop, deferred — see Next Loop)
- `RepositoryResolver.scoped()`/`.resolveFromManager()` are dead code (zero callers).
- `CursorPaginationRequest`/`CursorPaginationResult` types exist with no implementation.
- `RepositoryDiscoveryService`'s missing-metadata check duplicates `RepositoryProviderFactory`'s identical, earlier-running check.
- `datasource.tokens.ts`'s `getDatabaseAccessorToken` uses a global `Symbol.for(...)` registry, unlike `repository.tokens.ts`'s locally-scoped, cached `Symbol(...)` — now slightly more live since `DatabaseAccessor` is exported/reachable this loop.
- `repository.tokens.ts`'s `getRepositoryToken` cache keys by `repository.name` string rather than class reference — theoretical collision risk.
- `@Transactional()`'s default parameter is a whole-object default, not per-field — `@Transactional({isolationLevel: ...})` leaves `propagation` as `undefined` (functionally fine due to `TransactionExecutor`'s fallback, just misleading to read).

## Changes Made

- Added `libs/database/src/datasource/read-pin.context.ts`: a small `AsyncLocalStorage`-based context (mirrors `transactionContext`'s pattern) that pins one automatic read-retry to the exact `DataSourceState` selected for it.
- `DataSourceManager`: added `managerForState`, `repositoryForState`, `reportFailureForState`, `waitForRecoveryForState`, `peekReadState` (state-scoped variants of the existing role-based methods); existing `manager`/`reportFailure`/`waitForRecovery` methods now delegate to these. `waitForRecovery`'s `maxWaitMs` is now optional, defaulting to `options.retry?.readRecoveryTimeoutMs ?? DEFAULT_RETRY_OPTIONS.readRecoveryTimeoutMs`.
- `RepositoryResolver`: `resolve`/`manager` now consult `readPinContext.current` for READ-role calls; added `peekReadState`, `withPinnedState`, and optional `state` params on `reportFailure`/`waitForRecovery`.
- `BaseRepository.execute()`: for automatic (no explicit manager), READ-role retries, pins the reader up front via `resolver.peekReadState` + `resolver.withPinnedState`, and threads that same state into `reportFailure`/`waitForRecovery` on failure. Removed the hardcoded `RECOVERY_TIMEOUT_MS` static — now driven by config (see above).
- `DatabaseRetryOptions` gained `readRecoveryTimeoutMs?: number`; `DEFAULT_RETRY_OPTIONS` gained `readRecoveryTimeoutMs: 2_000` (same effective default as before).
- Added a doc comment on `DataSourceManager.updateServerIdentity` explaining the reconnect-on-server-change vs. log-only-on-role-change asymmetry is intentional.
- `DatabaseCoreModule.forRootAsync`'s `exports` now includes both `getDatabaseAccessorToken` tokens; `index.ts` now exports `InjectDatabase` and `DatabaseAccessor`.
- Added doc comments on `RepositoryRegistry` and the `DatabaseRepository()` decorator documenting the static-import-order requirement.
- New spec files: `utils/database-error.util.spec.ts`, `transaction/transaction.context.spec.ts`, `pagination/pagination.util.spec.ts`, `module/database.module.spec.ts` (DI-graph wiring test via `Test.createTestingModule`).
- Extended `repository/base.repository.spec.ts` with a regression test proving `reportFailure`/`waitForRecovery` target the pinned reader even when a simulated round-robin re-pick would otherwise select a different one.

## Why

User selected "High + Medium fixes" scope from the Phase 2 review; Low findings were explicitly deferred rather than bundled in, per the loop's own risk-classification discipline (Section 18) and to keep the diff focused.

## Tests

`libs/database` suite is now 14 spec files / 124 tests (up from 10 files / ~100 tests), all passing. Full monorepo suite: 68 suites / 491 tests, all passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Low-priority items listed above (dead code removal, incomplete cursor-pagination feature, redundant validation, DI token-strategy consistency, `@Transactional()` default-param clarity) — not started.
- No `ARCH.md` exists for this library yet; this loop was pure Improvement Loop (Sections 1-19), no Design Mode session preceded it.

## Next Loop

- Consider the deferred Low items, in particular the `Symbol.for` global-registry token risk (`datasource.tokens.ts`) — now more reachable since `DatabaseAccessor` is exported this loop.
- Decide fate of `RepositoryResolver.scoped()`/`.resolveFromManager()` (remove vs. find a use) and `CursorPaginationRequest`/`CursorPaginationResult` (implement vs. remove the unused types).

# Loop 002

**Library:** libs/database
**Date:** 2026-07-17

## Goal

Close the Low-priority backlog from Loop 001's Next Loop notes: the
`Symbol.for` token-collision risk, `RepositoryResolver`'s two zero-caller
public methods, and the unimplemented `CursorPagination*` types.

## Files Reviewed

- `repository/datasource.tokens.ts`, `decorators/inject-database.decorator.ts`,
  `module/database-core.module.ts` (all call sites of
  `getDatabaseAccessorToken`, to confirm cross-file symbol-identity is
  actually required before "fixing" it in a way that would break DI)
- `repository/repository-resolver.ts`, `repository/base.repository.ts`
  (to check whether `.scoped()`/`.resolveFromManager()` feed anything real)
- `pagination/pagination.types.ts`, `pagination/pagination.util.ts`,
  `repository/base.repository.ts` (to confirm `OffsetPagination*` is fully
  wired while `CursorPagination*` has zero implementation anywhere)

## Problems Found / Investigated

- `getDatabaseAccessorToken` used `Symbol.for()`, which interns into
  Node's *process-wide* global symbol registry — any other code anywhere
  in the process calling `Symbol.for('DATABASE_ACCESSOR:write')` would
  silently collide with this DI token. Confirmed the cross-file identity
  `Symbol.for` was providing is genuinely needed (the token is computed
  independently in `DatabaseCoreModule`'s `provide` and
  `InjectDatabase`'s `@Inject`, which must resolve to the identical
  symbol) — so the fix couldn't be "just use `Symbol()`", it had to
  preserve that guarantee without the global-registry side effect.
- `RepositoryResolver.resolveFromManager()`: a trivial one-line passthrough
  (`manager.getRepository(entity)`) that doesn't reference `this` at all —
  no value over calling the manager directly, zero callers anywhere.
- `RepositoryResolver.scoped()`: also zero callers, but *not* equivalent
  dead code — it's the only way to set `managerOverride` on a
  `BaseRepository` instance, and `BaseRepository`'s own `repository` getter
  actively checks `managerOverride` first. A half-built feature (consumer
  wired, producer unused), not an orphan.
- `CursorPaginationRequest`/`CursorPaginationResult`: confirmed zero
  implementation exists anywhere (`pagination.util.ts` only has
  `paginateOffset()`) and nothing constructs either type — unlike the
  sibling `OffsetPagination*` types, which are fully wired through
  `BaseRepository`.

## Changes Made

- `getDatabaseAccessorToken` now caches a plain (non-global) `Symbol()` per
  `DatabaseRole` in a module-scoped `Map`, giving the same cross-call
  identity guarantee as `Symbol.for()` without registering into the
  process-wide symbol registry. New `datasource.tokens.spec.ts` (3 tests:
  identity across calls, distinctness across roles, and a regression test
  proving the token is no longer found via `Symbol.for`/`Symbol.keyFor`).
- Removed `RepositoryResolver.resolveFromManager()`.
- Kept `RepositoryResolver.scoped()`, with a doc comment explaining what it
  does, why it has no current caller, and why it isn't dead code (the
  `managerOverride` mechanism it feeds is real).
- Removed `CursorPaginationRequest`/`CursorPaginationResult` from
  `pagination/pagination.types.ts`.

## Why

- User selected the recommended option for both decisions: keep `.scoped()`
  (real half-built feature) + remove `.resolveFromManager()` (true dead
  weight); remove the cursor-pagination placeholder types rather than
  build an unused implementation just to give them a consumer.
- The `Symbol.for` fix required understanding *why* it was chosen in the
  first place (cross-file token identity) before "fixing" it — swapping to
  a bare `Symbol()` per call site would have silently broken DI by making
  `provide`/`@Inject` resolve to different symbols. The `Map`-cached
  approach preserves the actual requirement while dropping the
  process-wide collision risk.

## Tests

`libs/database` suite is now 16 spec files / 130 tests (up from 15/127 —
adjusted for the new `datasource.tokens.spec.ts`). Full monorepo suite: 96
suites / 751 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` exists for this library yet.
- `RepositoryResolver` still has no dedicated spec file (pre-existing gap,
  not introduced this loop) — worth adding if a future loop wants to
  exercise `.scoped()`/`manager()`/`reportFailure()`/`waitForRecovery()`
  directly rather than only through `BaseRepository`'s integration tests.

## Next Loop

- No Critical/High findings open. `libs/database` is now at the same
  stopping point as `libs/cache`/`libs/queue`/`libs/workflow` — all four
  shared libraries have completed at least one full ci.loop pass plus their
  respective Next Loop backlogs. Remaining work across all four is either
  fresh review passes or the coverage gaps noted in each library's own
  LOOP.md (`RepositoryResolver` spec here; `step-persistence.ts`-adjacent
  files were already closed in `libs/workflow`).

# Loop 003

**Library:** libs/database
**Date:** 2026-07-17

## Goal

Close the last concretely-noted gap from Loop 002: `RepositoryResolver` had
no dedicated spec file, despite being a real coordination point between
transaction context, read-pin context, and the datasource manager.

## Files Reviewed

- `repository/repository-resolver.ts`
- `transaction/transaction.context.ts`, `datasource/read-pin.context.ts`
  (both real `AsyncLocalStorage`-backed singletons, driven directly in
  tests via their own `.run()` rather than mocked, matching how
  `transaction.context.spec.ts` already tests the former)
- `datasource/datasource.manager.ts` (method signatures for
  `repository`/`repositoryForState`/`manager`/`managerForState`/
  `reportFailure(ForState)`/`waitForRecovery(ForState)`/`peekReadState`)

## Changes Made

- New `repository-resolver.spec.ts` (16 tests) covering every method:
  - `resolve`/`manager`: active-write-transaction precedence, pinned-read
    precedence, default-datasource-manager fallback, and that a WRITE
    resolve ignores an active read pin (role-gating is correct, not just
    "whichever context is present wins").
  - `dataSource`, `peekReadState`: plain delegation.
  - `withPinnedState`: proves the state is visible to code run inside the
    callback and cleared afterward (via `readPinContext.current`).
  - `reportFailure`/`waitForRecovery`: state-provided vs. role-only paths.
  - `scoped`: constructs the repository with the right role/resolver args,
    and that `managerOverride` is set non-enumerable/read-only (matching
    the `Object.defineProperty` call's actual flags — a plain object-spread
    assertion wouldn't have caught a regression to a mutable/enumerable
    property).

## Why

- This was the only remaining action item after Loop 002 closed every
  other backlog entry across all four shared libraries — a natural stop
  before broader work (fresh review passes) rather than backlog-driven
  work.

## Tests

`libs/database` suite is now 16 spec files / 143 tests (up from 130). Full
monorepo suite: 97 suites / 767 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this library.

## Next Loop

- No Critical/High findings, no noted coverage gaps remain open in
  `libs/database`. All four shared libraries (`cache`, `database`, `queue`,
  `workflow`) have now closed every backlog item raised across their
  respective loops. Further work from here would be a fresh Phase 1/2
  review pass on any of the four, or a Design Mode session if any library's
  scope is being deliberately extended rather than refined.

---

# Loop 004

**Library:** libs/database
**Date:** 2026-07-20

## Goal

Fresh Phase 1/2 review pass — no backlog was open (Loop 003 closed
everything), so this was open-ended: re-read the transaction/retry/resolver
core with an adversarial eye rather than working a known TODO list.

## Files Reviewed

- `repository/base.repository.ts` — `execute()`'s retry-on-connectivity-error
  path, `findOneForUpdate`/`findOneForShare`/`findOneOptimistic`.
- `repository/repository-resolver.ts` — how `resolve`/`manager` route
  WRITE+active-transaction vs. READ+pinned-state vs. plain role lookups.
- `datasource/datasource.manager.ts` — `performReconnect` (confirmed it
  replaces `state.dataSource` with a *new* `DataSource` instance rather than
  mutating the existing one) and `waitForRecoveryForState`.
- `transaction/transaction.context.ts` — confirmed `active`/`requireManager()`
  are driven purely by `AsyncLocalStorage` state and are untouched by
  datasource health/reconnection.
- `transaction/transaction.executor.ts` — re-verified the `timeoutMs` path
  (log-and-wait-for-real-completion, not abort) against its own tests;
  confirmed this is intentional design, not a bug, before moving on.
- `repository/base.repository.spec.ts` — confirmed no existing test covered
  a connectivity failure on a read call issued inside an active transaction.

## Problems Found

**Critical**
- `BaseRepository.execute()`'s automatic retry-after-recovery path did not
  account for an active `@Transactional()` context. `RepositoryResolver.resolve`
  ties a WRITE-role repository inside an active transaction to
  `transactionContext.requireManager()` — a single `EntityManager` fixed for
  the transaction's lifetime. On a connectivity error, `DataSourceManager`
  reconnects by replacing `state.dataSource` with a brand-new `DataSource`
  (`performReconnect` → `factory.recreate`), but never touches the already-
  bound transactional manager. Since `runRead` always passes
  `retryOnFailure: true` regardless of role, any read call (`find`,
  `findOne`, `findOneForUpdate`, etc.) made on a WRITE-role repository
  inside an active transaction would, on connectivity failure, wait for
  datasource recovery and then retry — re-resolving the exact same dead
  manager and failing again (or behaving unpredictably), instead of the
  clean fail-fast `ServiceUnavailableException` the codebase already gives
  for the equivalent explicit-manager case. This is exactly the "commit
  state unknown, don't silently retry" hazard `runWrite`/the explicit-manager
  branch already protect against — just unguarded for the implicit
  transactional-manager case. Confirmed via `resolver.ts`/`datasource.manager.ts`
  reading, not just inspection: no existing test exercised this path.

**High / Medium / Low**
- (none)

## Changes Made

- `base.repository.ts`: `execute()`'s catch block now checks
  `this.role === DatabaseRole.WRITE && transactionContext.active` and, if
  true, fails fast with a new `ServiceUnavailableException` message
  (transaction outcome unknown, manager cannot be recovered automatically)
  instead of attempting `waitForRecovery` + retry. Placed alongside the
  existing `explicitManager` fail-fast branch, same reasoning.
- `base.repository.spec.ts`: new regression test — a `find()` call on a
  WRITE-role repository run inside `transactionContext.run(manager, ...)`
  that hits a connectivity error now asserts `waitForRecovery` is never
  called and the transaction-specific message is thrown.

## Why

- Matches the library's own established principle (`CLAUDE.md`: "writes are
  never silently retried, since a write's commit state is unknown") — the
  gap was that this principle was enforced by role (`runWrite` vs.
  `runRead`) rather than by "is a transactional manager involved," so a read
  call inside a transaction fell through the gap.

## Tests

1 new test. `libs/database` suite: 16 suites / 144 tests (up from 143).
Full monorepo suite: 133 suites / 1040 tests, all passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- None outstanding for this library.

## Next Loop

- No Critical/High findings remain open. Next loop would be a fresh Phase
  1/2 pass on `libs/cache`, `libs/queue`, or `libs/workflow`, or a Design
  Mode session if scope is being deliberately extended.

---

# Loop 005

**Library:** libs/database
**Date:** 2026-07-21

## Goal

Fresh, adversarial Phase 1/2 pass with no open backlog (Loop 004 closed
everything) — read the transaction-commit path end to end rather than
re-verifying already-tested behavior, on the theory that the commit/rollback
hook mechanism (`runOnTransactionCommit`/`runOnTransactionRollback`/
`runOnTransactionComplete`, `transaction.hooks.ts`) had never itself been
adversarially reviewed in prior loops (Loops 001-004 focused on the
reader-pin/retry/resolver machinery).

## Files Reviewed

- `transaction/transaction.executor.ts` — every propagation branch
  (`NOT_SUPPORTED`, `REQUIRES_NEW`, `MANDATORY`, `NEVER`, `SUPPORTS`,
  ambient-join, `NESTED`, default fresh-`REQUIRED`), cross-checked against
  `node_modules/typeorm/entity-manager/EntityManager.js`'s actual
  `transaction()` implementation to confirm exactly when TypeORM issues the
  physical `COMMIT`.
- `transaction/transaction.context.ts`, `transaction/transaction.hooks.ts` —
  how `commit()`/`rollback()` read and clear the `AsyncLocalStorage`-scoped
  hooks `Set`s.
- `transaction/transaction.executor.spec.ts`,
  `transaction/transaction-hooks.integration.spec.ts` (real `better-sqlite3`
  `DataSource`) — confirmed no existing test asserted hook-firing order
  relative to the physical `COMMIT`/`ROLLBACK`, only relative to the
  callback's own resolution.
- `libs/workflow/src/persistence/adapters/database/database-workflow-transaction-runner.ts`
  — confirmed a real consumer (`DatabaseWorkflowTransactionRunner.afterCommit()`)
  is built directly on `runOnTransactionCommit()`, i.e. a real caller depends
  on "after commit" meaning "after the data is durably committed."

## Problems Found

**Critical**
- `TransactionExecutor`'s commit/rollback hooks fired based on when the
  user's callback settled, not when the transaction's physical
  `COMMIT`/`ROLLBACK` actually executed. For the default (fresh `REQUIRED`)
  path, `dataSource.transaction(transaction)` delegates to TypeORM's
  `EntityManager.transaction()`, whose own source is:
  `const result = await runInTransaction(queryRunner.manager); await
  queryRunner.commitTransaction();` — i.e. TypeORM always commits *after*
  our callback (`transaction`) resolves. Our `transaction` callback called
  `transactionContext.commit()` (firing every `runOnTransactionCommit()`/
  `runOnTransactionComplete()` hook) from *inside* itself, strictly *before*
  TypeORM's own `commitTransaction()` ran. `REQUIRES_NEW` had the same bug
  via its recursive `this.execute()` call, plus a second, narrower defect:
  the outer `REQUIRES_NEW` code called `transactionContext.commit()` a
  *second* time after its own `runner.commitTransaction()`, but by then the
  `AsyncLocalStorage` context had reverted to whatever was active *before*
  `REQUIRES_NEW` started — meaning that second call operated on an
  **outer/ambient transaction's hook set** (if `REQUIRES_NEW` was invoked
  nested inside an active transaction), not the inner transaction's own.
  Net effect: any commit-hook side effect (e.g. `libs/workflow`'s
  `DatabaseWorkflowTransactionRunner.afterCommit()`, used to defer work
  until data is durably committed) could run *before* the physical `COMMIT`
  — including in the rare case where `COMMIT` itself subsequently fails —
  silently violating the exact "don't treat an uncertain outcome as
  certain" guarantee this library already enforces elsewhere (Loop 004's
  fix, `CLAUDE.md`'s stated write-retry principle). No existing test caught
  this because all hook tests only asserted hooks fired relative to the
  callback, never relative to the physical `COMMIT`/`ROLLBACK` call.

**High / Medium / Low**
- (none)

## Changes Made

- `transaction/transaction.executor.ts`: replaced the default fresh-
  transaction path's use of `dataSource.transaction(...)` (and
  `REQUIRES_NEW`'s bespoke queryRunner handling) with a single shared
  private `runOwnedTransaction()` that manually drives the `QueryRunner`
  (`connect` → `startTransaction` → run callback inside
  `transactionContext.run(runner.manager, ...)` → `runner.commitTransaction()`
  → **then** `transactionContext.commit()`, all still inside the same
  `AsyncLocalStorage` context; on error, `runner.rollbackTransaction()`
  **then** `transactionContext.rollback(error)`). `REQUIRES_NEW` now just
  suspends the ambient transaction (`transactionContext.runWithoutTransaction`)
  and delegates to the same helper, removing the old recursive
  `this.execute()` call and its erroneous second `transactionContext.commit()`
  entirely.
- Extracted the caller-supplied `options.manager`/`options.queryRunner`
  branches (where the caller owns the physical commit elsewhere, so
  firing hooks immediately after the callback settles is already correct)
  into a small `runWithAmbientManager()` helper — behavior unchanged there.
- Extracted the timeout-race logic (unchanged behavior: on timeout, log and
  keep waiting for the real operation rather than abandoning it) into a
  shared `runWithTimeout()` used by both helpers above. Dropped one
  dead/no-op `transactionContext.rollback(error)` call that lived in the old
  timeout-catch block outside any active `AsyncLocalStorage` context (it
  could never find an active hook set to fire).
- `transaction/transaction.executor.spec.ts`: updated the three
  timeout-handling tests and the "NESTED starts a fresh transaction" test to
  mock `createQueryRunner` instead of `dataSource.transaction` (matching the
  new mechanism); added assertions that the queryRunner isn't released until
  the real (post-timeout) operation finishes and that rollback is invoked on
  a real post-timeout failure.
- `transaction/transaction-hooks.integration.spec.ts` (real `better-sqlite3`
  `DataSource`): added two regression tests spying on
  `runner.commitTransaction`/`runner.rollbackTransaction` to assert the
  physical commit/rollback always happens **before** the corresponding hook
  fires (`['callback', 'physical-commit', 'commit-hook']` /
  `['callback', 'physical-rollback', 'rollback-hook']`).

## Why

- Matches this library's own established, previously-enforced principle
  (Loop 004; `CLAUDE.md`: writes' commit state must never be treated as
  certain when it isn't) — the gap here was the same class of bug in a
  different place: hook-firing timing implicitly assumed "callback resolved"
  meant "transaction committed," which is false for every code path that
  starts its own transaction.
- Cross-checked against `libs/queue` and `libs/workflow` per the loop's
  cross-lib-consistency instruction: `libs/queue`'s outbox/inbox don't use
  `runOnTransactionCommit`/`TransactionExecutor` directly (they drive their
  own repository writes inside the caller's `@Transactional()`/outer
  transaction), so they're unaffected. `libs/workflow`'s
  `DatabaseWorkflowTransactionRunner.execute()`/`.executeOrJoin()` call
  `TransactionExecutor.execute(operation)` with no options — exactly the
  default fresh-`REQUIRED` path this loop fixed — and its `afterCommit()` is
  a thin wrapper over `runOnTransactionCommit()`, so it now gets the
  ordering guarantee its name implies.

## Tests

Added 5 new tests (2 in `transaction.executor.spec.ts`'s assertions extended
in place, 2 new in `transaction-hooks.integration.spec.ts`, plus 1 new
assertion in the NESTED test). `libs/database` suite: 16 suites / 146 tests
(up from 144), all passing. Full monorepo suite: 133 suites / 1046 tests, all
passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this library.

## Next Loop

- No Critical/High findings remain open. Next loop would be a fresh Phase
  1/2 pass on `libs/cache`, `libs/queue`, or `libs/workflow`, or a Design
  Mode session if scope is being deliberately extended.

---

# Loop 006

**Library:** database

**Date:** 2026-07-22

## Goal

Close the `entities` type-cast gap flagged as Low in `apps/server/LOOP.md` Loop 001 and
`apps/worker/LOOP.md` Loop 002: both apps needed `as unknown as DatabaseBootstrapOptions['entities']`
to pass their entity-class arrays to `DatabaseModule.forRoot(...)`.

## Files Reviewed

- `libs/database/src/interfaces/database-bootstrap-options.interface.ts` (the `entities` field)
- `libs/database/src/interfaces/database-module-options.ts`,
  `database-options.interface.ts` (confirmed both derive from `DatabaseBootstrapOptions` — one
  fix point, not several)
- `libs/database/src/config/database-options.factory.ts` (confirmed `entities` is only ever
  spread verbatim into TypeORM's `DataSourceOptions`, never inspected/called — so a construct
  signature is the correct shape, not a functional one)
- `node_modules/typeorm/data-source/BaseDataSourceOptions.d.ts` (TypeORM's own
  `entities?: MixedList<Function | string | EntitySchema>` — confirms the intent was "any entity
  class," not "any callable")
- `apps/server/src/app.module.ts`, `apps/worker/src/worker.module.ts` (the two call sites needing
  the cast)

## Problems Found

**Low**
- `entities` was typed as `MixedList<string | ((...args: any[]) => any) | EntitySchema<any>>` — a
  **call** signature. TypeORM entity classes only have a **construct** signature
  (`new (...args) => T`), so real entity classes never structurally satisfied this type, forcing
  both app modules to reach for `as unknown as ...`, which defeats any check that the right
  classes were actually passed.

## Changes Made

- `libs/database/src/interfaces/database-bootstrap-options.interface.ts`: `entities` now typed
  `MixedList<string | (new (...args: any[]) => unknown) | EntitySchema<any>>` — a construct
  signature, mirroring the pattern the `migrations` field on the same interface already used
  correctly one line below. (`Function` was tried first to mirror TypeORM's own upstream type
  verbatim, but this repo's `@typescript-eslint/no-unsafe-function-type` rule rejects it — the
  construct-signature form achieves the same structural fit without tripping that rule.)
- `apps/server/src/app.module.ts`, `apps/worker/src/worker.module.ts`: removed the
  `as unknown as DatabaseBootstrapOptions['entities']` casts (and the now-unused
  `DatabaseBootstrapOptions` import in both files) — the plain entity-class arrays now typecheck
  directly.

## Why

Same class of gap as picking a construct-signature type for `migrations` already got right on the
adjacent field — no new type vocabulary introduced, just consistency within the same interface.
Removing the casts restores the actual value of the type: passing something that isn't an entity
class (or forgetting one) will now be a real typecheck error at each app's call site instead of
silently passing through `unknown`.

## Tests

No new tests — pure type-level fix, no runtime behavior changed. Full monorepo suite: 135 suites /
1054 tests, all passing (unchanged count).

## Build

PASS (`npm run typecheck`; also explicitly verified `npx nest build server` and
`npx nest build worker` both compile clean with the casts removed)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this library.

## Next Loop

- No Critical/High findings remain open. Next loop would be a fresh Phase 1/2 pass on
  `libs/cache`, `libs/queue`, or `libs/workflow`, or a Design Mode session if scope is being
  deliberately extended.

---

# Loop 007

**Library:** libs/database
**Date:** 2026-07-23

## Goal

Fresh adversarial Phase 1/2 pass, targeting files that hadn't had individual deep-dive attention
in prior loop write-ups: `connection-monitor.ts`, `health/database-health.service.ts`,
`datasource/datasource.factory.ts`, `transaction/transaction-provider-enhancer.ts`,
`repository/repository.providers.ts`, `repository/repository-discovery.service.ts`.

## Files Reviewed

- `datasource/connection-monitor.ts` — `healthCheck`'s writer+readers concurrent check with a
  `running` re-entrancy guard, `check()`'s success/failure paths, `toBooleanFlag` (MySQL
  `@@read_only` Buffer/numeric coercion) — traced the exact call order inside `check()`'s success
  path and found a new issue (below).
- `datasource/datasource.manager.ts` — `updateHealth`, `updateServerIdentity`,
  `reconnectState`/`performReconnect`/`markConnected`/`markFailed`, `selectReader` (reader
  eligibility gate), and the `reconnectPromise`-based dedup guard shared by
  `ensureConnected`/`reconnectState` — re-verified the dedup guard is sound (no double-reconnect
  race), which is what led to the actual finding in the health/identity update interaction instead.
- `health/database-health.service.ts` — thin delegation wrapper over `DataSourceManager`; no
  issues.
- `datasource/datasource.factory.ts` — `create`/`destroy`/`recreate`; `recreate`'s
  create-new-before-destroying-old ordering (and destroying the new one if destroying the old
  fails) re-verified as correct and matching `DataSourceManager.performReconnect`'s expectations.
- `transaction/transaction-provider-enhancer.ts` — the `onModuleInit`-time method-wrapping
  mechanism (`instance[methodName] = (...) => executor.execute(...)`); traced own-property vs.
  prototype shadowing, warn-without-instance path for REQUEST/TRANSIENT-scoped providers. No
  issues found in this loop's scope.
- `repository/repository.providers.ts`, `repository/repository-discovery.service.ts` — DI
  provider factory and boot-time registration logging; no issues.

## Problems Found

**Critical** — (none)
**High** — (none)

**Medium**
- `ConnectionMonitor.check()`'s success path calls `this.manager.updateServerIdentity(state,
  identity)` immediately followed by `this.manager.updateHealth(state, { healthy: true, ... })`.
  `updateServerIdentity`, when it detects a MySQL server-identity change (failover promoted a
  different server behind the same host), synchronously sets `state.status =
  DataSourceStatus.RECONNECTING` (inside `performReconnect`, which runs synchronously up to its
  first `await` when kicked off via `reconnectState`) before kicking off the actual
  reconnect in the background. The very next line in `check()` called `updateHealth(healthy:
  true)`, whose success branch unconditionally set `state.status = DataSourceStatus.READY` —
  immediately stomping the just-set `RECONNECTING` marker back to `READY`. Since
  `DataSourceManager.selectReader()`'s eligibility check requires both `healthy` and `status ===
  READY`, this meant a datasource mid-failover-reconnect (its `DataSource` object about to be
  replaced by `factory.recreate`) could still be selected for new reads during the exact window
  it was being torn down/recreated underneath — the one scenario `updateServerIdentity`'s own doc
  comment says a reconnect is mandatory for. Not a contrived edge case: this is the intended path
  through `ConnectionMonitor.check()` on every real MySQL failover event, and no existing test
  (only mocked-manager tests in `connection-monitor.spec.ts`) exercised the interaction between
  the two real `DataSourceManager` methods in sequence.

**Low** — (none newly found this loop)

## Changes Made

- `datasource/datasource.manager.ts`: `updateHealth`'s healthy branch now only overwrites
  `state.status` to `READY` when the current status isn't already `RECONNECTING` — leaving an
  in-flight reconnect's status alone until `performReconnect`'s own `markConnected()` (or
  `markFailed()`) call resolves it naturally. `state.healthy = true` is still set unconditionally
  since the health-check query itself did genuinely succeed; only the `status` field (the one
  `selectReader()` actually gates on) is protected.
- `datasource/datasource.manager.spec.ts`: added a regression test reproducing
  `ConnectionMonitor.check()`'s exact call order (`updateServerIdentity` with a changed
  `serverUuid`, immediately followed by `updateHealth(healthy: true)`) against a `recreate` that
  never resolves (to inspect mid-flight state), asserting `status` stays `RECONNECTING` rather
  than being stomped back to `READY`.

## Why

- Direct instance of the exact hazard `updateServerIdentity`'s own doc comment (added Loop 001)
  describes as the reason a reconnect is mandatory on server change — the reconnect was correctly
  triggered, but a same-tick ordering issue in the caller undid the one status signal
  `selectReader()` depends on to actually keep routing away from that datasource during the
  window it matters. Fix is minimal and additive (a single guard condition), doesn't change the
  public shape of `updateHealth`, and doesn't affect the common (no-server-change) path at all —
  MEDIUM risk per ci.loop §18 (datasource/connectivity-adjacent behavior change, but narrowly
  scoped to a state transition that was already broken, not a new capability).
- Considered whether `state.healthy` should also be left alone during `RECONNECTING`, but the
  health-check query did succeed against the (still-live, not-yet-destroyed) old connection at
  the moment it ran — `healthy` reporting `true` is accurate; it's specifically `status` (the
  routing-eligibility gate) that shouldn't have been overwritten.

## Tests

`libs/database` suite is now 17 spec files / 145 tests (up from 144). Full monorepo suite: 145
suites / 1173 tests, all passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this library.

## Next Loop

- No further Critical/High/Medium findings identified this pass beyond the one fixed. Next loop
  would be a fresh Phase 1/2 pass on any of the four original shared libraries, or a Design Mode
  session if scope is being deliberately extended.

---

# Loop 008

**Library:** libs/database
**Date:** 2026-07-23

## Goal

Second adversarial pass in the same session as Loop 007, matching the "two consecutive clean
passes" bar already reached this session by `libs/cache`/`libs/queue`. Also specifically checked
whether the failure-path analog of Loop 007's `RECONNECTING`-status-stomping bug exists anywhere
(i.e. does `reportFailureForState`'s call chain have the same "sets a transitional status then
immediately overwrites it" shape in reverse).

## Files Reviewed

- `repository/base.repository.ts` (full CRUD surface) — traced every write method
  (`save`/`delete`/`update`/`insert`/etc.) confirming none pass `manager` through to
  `runWrite`/`execute`'s `explicitManager` parameter, unlike the read methods. Confirmed this is
  inert rather than a bug: `runWrite` always sets `retryOnFailure: false`, so `execute()`'s catch
  block takes the generic "write operation, may or may not have committed" branch before it would
  ever check `explicitManager` — the parameter is simply unreachable dead weight on the write path,
  not a behavior difference.
- `repository/repository-resolver.ts` — re-verified `resolve`/`manager`'s WRITE+transaction vs.
  READ+pinned-state precedence and `scoped()`'s `managerOverride` mechanism; unchanged from Loop 003.
- `datasource/datasource.manager.ts`'s `reportFailureForState`/`markFailed` — specifically checked
  for a mirror-image version of Loop 007's bug (does the failure path also stomp a status a
  concurrent operation just set). `updateHealth`'s failure branch only downgrades `status` to
  `DEGRADED` when it was `READY` (conditional, not unconditional like the pre-fix healthy branch
  was), so no analogous bug exists in the failure direction.
- `pagination/pagination.util.ts` — re-confirmed page/limit clamping and `totalPages`/`hasNext`
  math; unchanged from Loop 001.

## Problems Found

**Critical / High / Medium / Low** — none this pass.

## Changes Made

None — nothing found that crossed the bar for a change.

## Why

Two consecutive clean adversarial passes (Loop 007 found and fixed one real Medium; this loop
found nothing new after specifically hunting for the failure-path mirror of that same bug class)
meets the ci.loop §16 stopping condition for this library, matching `libs/cache`/`libs/queue`'s
status this session.

## Tests

No test changes. Full monorepo suite: 145 suites / 1175 tests, all passing (unchanged from before
this pass — no code touched).

## Build

Not re-run — no code changed this loop.

## Lint

Not re-run — no code changed this loop.

## Remaining TODO

- None outstanding for this library.

## Next Loop

- No Critical/High/Medium findings across two consecutive adversarial passes. `libs/database`
  remains at a natural stopping point per Section 16 until a new concrete finding or requirement
  surfaces.

---

# Loop 008

**Library:** libs/database
**Date:** 2026-07-23

## Goal

Following the same-day live-MySQL verification added for `libs/auth` (Loop 019) and
`libs/workflow` (Loop 021), attempt the analogous verification here: `BaseRepository.execute()`'s
write path is documented to fail fast with `ServiceUnavailableException` on a real connectivity
error rather than retry (commit state is unknown), and that claim had only ever been exercised
against mocked `isDatabaseConnectivityError` inputs, never a genuine driver-level error.

## Files Reviewed

- `repository/base.repository.ts`'s `execute()` (the write-fail-fast / read-retry branch under
  test), `utils/database-error.util.ts`'s `isDatabaseConnectivityError` (the real MySQL/Postgres/
  network error codes it matches), `datasource/datasource.factory.ts`'s `create()`/`destroy()`.

## Problems Found

None — this loop is a verification attempt, not a review pass, and it did not complete.

## Changes Made

None. Probed (via a throwaway spec, not committed) whether a real `mysql2`-backed `DataSource`
could be made to throw one of `isDatabaseConnectivityError`'s real error codes
(`PROTOCOL_CONNECTION_LOST`/`ECONNRESET`/etc.) without disrupting the shared `make compose-up`
MySQL container other libraries' tests also depend on. Result: calling `dataSource.destroy()`
then issuing a query does **not** reach the driver at all — TypeORM's own `DataSource` guards
reject the query client-side with `code: undefined, "Connection is not established with mysql
database"`, which `isDatabaseConnectivityError` correctly does *not* match (it isn't a real
connectivity error, just TypeORM refusing to use a pool it was told to tear down). That means
`ds.destroy()` is not a faithful stand-in for a genuine mid-operation connection loss — it
proves nothing about the code path under test. Generating an actual `PROTOCOL_CONNECTION_LOST`/
`ECONNRESET` would require either killing the real MySQL container's process/socket mid-query
(disrupts the shared instance every other library's live tests — including this session's new
auth/workflow MySQL specs — depend on) or a purpose-built network-partition harness (a toxiproxy-
style TCP proxy sitting between the app and MySQL), which is real infrastructure work beyond a
single verification loop, not something safely improvised against shared dev infra.

## Why

- Correctly abandoned rather than forced, for the same reason `libs/auth` Loop 018 abandoned its
  own live-MySQL attempt: a technique that risks the shared container (or, here, one that silently
  produces a non-representative result) doesn't clear the bar for "verification," and ci.loop's
  own engineering principles (§17, correctness over completeness-for-its-own-sake) argue against
  manufacturing a fake positive just to close a TODO.
- Unlike auth/workflow's gaps — which only needed a *concurrency* condition real MySQL naturally
  provides (a connection pool) — this gap needs a *fault-injection* condition (a connection that
  is healthy, then genuinely drops) that neither the shared container nor a plain `DataSource`
  API can produce safely. That's a materially different, larger piece of infrastructure
  (toxiproxy or equivalent), not a same-shaped fix.

## Tests

No test changes (the probe spec was never committed). Full monorepo suite unchanged: 149 suites /
1194 tests, all passing.

## Build

Not re-run — no code changed this loop.

## Lint

Not re-run — no code changed this loop.

## Remaining TODO

- The write-fail-fast path's live-infra verification remains open, but is now correctly
  characterized: it needs a fault-injection proxy (e.g. toxiproxy) between the app and MySQL, not
  just access to a scratch schema. Don't re-attempt via `dataSource.destroy()` or similar
  in-process tricks — this loop confirmed that produces a non-representative client-side error,
  not a real connectivity failure.

## Next Loop

- Revisit only if a fault-injection proxy is added to the local dev stack for some other reason
  (at which point this becomes a small addition), or if a user explicitly wants that
  infrastructure built solely for this verification.

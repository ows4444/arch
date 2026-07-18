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

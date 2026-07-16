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

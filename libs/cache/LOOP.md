# Loop 001

**Library:** libs/cache
**Date:** 2026-07-17

## Goal

First ci.loop pass over `libs/cache`. No prior LOOP.md/ARCH.md existed. Full Phase 1 (Understand) read of all 51 files (42 source + 9 spec files at the time), followed by a ranked Phase 2 (Review), then Phase 3/4 (Plan/Implement) scoped to the user-selected High + Medium findings.

## Files Reviewed

- All files under `libs/cache/src/**` (root-level manager/registry/factory/validator/constants, `caches/`, `clocks/`, `core/`, `interfaces/`, `nest/`, `policies/`, `storage/`, `utils/`) plus `index.ts`.

## Problems Found

**Critical**

- (none)

**High**

- Mutation-through-reference in `MemoryCache`/`MemoryCacheStorage`: `get()` returned the live `CacheEntry` object from the backing `Map`; only the `CacheEntry` wrapper was shallow-cloned on write, never `entry.value` itself. A caller mutating a returned object silently corrupted the cached value with no `set()` call — exactly the bug class this repo's caching checklist calls out by name. Zero test coverage of the behavior existed.
- `cache.module.validator.ts` (the DFS cycle-detector + reference-validator that runs on every app boot via `forRoot`/`forRootAsync`) had zero test coverage.

**Medium**

- `multi-level.cache.spec.ts` only tested `clear()`/`statistics()` — the actual composition logic (`get`/`set`/`delete`/`has`/`keys`/`entries`, including TTL-preserving promotion from L2) was untested.
- Latent TTL-drop when a `multi-level` cache is nested as another multi-level's L2: `MultiLevelCache` didn't implement `getWithMetadata`, so promotion fell into the no-TTL fallback path. The validator permits this nesting.
- `CacheModuleAsyncOptions` supported only `useFactory`, unlike sibling libs' `useFactory`/`useExisting`/`useClass` — inconsistent with CLAUDE.md's "same shape everywhere" convention for dynamic modules.
- `runPlugins` was implemented identically (copy-pasted) in both `memory.cache.ts` and `redis.cache.ts`.
- The default serializer (`JsonCacheSerializer`, used by `CacheFactory.redis()` and `RedisCacheStore`'s own constructor default) didn't guard `JSON.stringify` against circular references — an unguarded `TypeError` on `set()`, plausible given this monorepo's TypeORM entities commonly have bidirectional relations.
- `MultiLevelCache.size()`/`keys()` silently swallowed a rejecting level (e.g. Redis, which always rejects `keys()`) into `[]` with no signal — a statistic that read as authoritative but was systematically partial.
- `cache-registry.ts`, `cache.factory.ts`, and `nest/cache.service.ts` had no dedicated test coverage despite real wiring/injectable logic.

**Low** (out of scope this loop, deferred — see Next Loop)

- `CacheModule` is a plain `@Module({})`, not `@Global()`, unlike `DatabaseCoreModule`/`QueueModule` — possibly intentional, undocumented either way.
- `CacheOptions` (`core/cache-options.ts`) is dead/orphaned — zero consumers anywhere.
- `CacheEntry.metadata`/`.size` fields are declared but never read or written.
- `isStatisticsAwareCache` isn't re-exported from the barrel while its sibling `isMetadataAwareCache` is.
- Redis-backed `clear()`/`size()`/etc. always reject (correct/safe per the multi-tenant-isolation checklist), meaning `CacheManager.clear()` is unusable in the app's actual config with no documented workaround.
- Redis TTL is rounded up to whole seconds vs. `MemoryCache`'s millisecond precision — an L1/L2 precision mismatch worth documenting.
- Stacking `@Cacheable` with `@CachePut`/`@CacheEvict` on the same method: a cache hit silently skips the put/evict side effects (only the miss path runs them) — undocumented, untested edge case.

## Changes Made

- `MemoryCacheOptions`/`MemoryCacheConfiguration` gained an opt-in `cloneValues?: boolean` (default `false`, current reference-sharing behavior unchanged). When enabled, `MemoryCache` runs values through `structuredClone` on `set()`, `get()`, `getWithMetadata()`, `values()`, and `entries()`, so the cache and the caller never share a mutable reference. Kept opt-in rather than default-on because `structuredClone` silently strips class prototypes (e.g. a cached TypeORM entity would lose its class identity/methods) — a decision made explicitly with the user rather than picked silently.
- `MultiLevelCache` now implements `getWithMetadata` (satisfying `MetadataAwareCache`), fixing TTL-preserving promotion when a multi-level cache is itself nested as another multi-level cache's L2.
- `MultiLevelCache.safeKeys`/`safeEntries` now log at `debug` level when a level's `keys()`/`entries()` rejects, so the "size()/keys() only reflects one level" condition is discoverable instead of silent. Debug (not warn) since it's a permanent, expected condition for Redis-backed levels, not an actionable failure.
- Extracted the duplicated `runPlugins` loop into a shared `runCachePlugins` helper (`interfaces/cache-plugin.interface.ts`), used by both `MemoryCache` and `RedisCacheStore`.
- `CacheFactory.redis()`'s default serializer and `RedisCacheStore`'s own constructor default both switched from `JsonCacheSerializer` to `SafeJsonCacheSerializer`, so an unguarded circular-reference value now throws a clear wrapped error instead of a raw native `TypeError`.
- Added `CacheOptionsFactory` interface (mirroring `libs/database`'s `DatabaseOptionsFactory`) and `useExisting`/`useClass` support on `CacheModuleAsyncOptions`, implemented via a new `CacheModule.createAsyncOptionsProviders` mirroring `DatabaseCoreModule.createAsyncProviders`'s branching. Existing `useFactory`-only callers (`src/app.module.ts`) remain unchanged and backward compatible.
- New spec files: `cache.module.validator.spec.ts` (13 tests: empty config, missing `defaultCache`, unknown `l1`/`l2` refs, self-reference, 2-cycle, 3-node cycle, valid deep nesting, independent multi-level caches), `cache-registry.spec.ts`, `cache.factory.spec.ts`, `nest/cache.service.spec.ts`.
- Extended `caches/multi-level.cache.spec.ts` (get/set/delete/has/keys/entries/getWithMetadata composition, including the nested-multi-level TTL-preservation regression test), `caches/memory.cache.spec.ts` (reference-semantics tests: default reference-sharing behavior preserved, `cloneValues: true` isolation for set/get/getWithMetadata/values/entries), and `nest/cache.module.spec.ts` (useFactory/useClass/useExisting/none-set paths).

## Why

User selected "High + Medium fixes" scope from the Phase 2 review; Low findings were explicitly deferred to keep the diff focused. The `cloneValues` clone-strategy specifically required a user decision (opt-in vs. default-on vs. document-only) since `structuredClone`'s prototype-stripping behavior is a real tradeoff for a monorepo with heavy TypeORM entity usage — not something to silently pick for a shared caching primitive.

## Tests

`libs/cache` suite is now 13 spec files / 140 tests (up from 9 files / 77 tests). Full monorepo suite: 72 suites / 554 tests, all passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Low-priority items listed above (`@Global()` consistency question, dead `CacheOptions`/`CacheEntry` fields, barrel symmetry for `isStatisticsAwareCache`, Redis `clear()` DX sharp edge, Redis/Memory TTL precision mismatch, `@Cacheable`+`@CachePut`/`@CacheEvict` stacking edge case) — not started.
- No `ARCH.md` exists for this library yet; this loop was pure Improvement Loop (Sections 1-19), no Design Mode session preceded it.

## Next Loop

- Consider the deferred Low items, in particular whether `CacheModule` should become `@Global()` for consistency with `DatabaseCoreModule`/`QueueModule` (needs a decision, not just a mechanical fix — may be an intentional named-cache-scoping choice).
- Decide fate of `core/cache-options.ts`'s `CacheOptions` (remove vs. find a use) and `CacheEntry.metadata`/`.size` (implement vs. remove).
- Consider whether Redis-backed caches should support a "best-effort partial clear" mode, or whether the current all-reject behavior should just be better documented at the `CacheManager.clear()` call site.

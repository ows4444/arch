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

# Loop 002

**Library:** libs/cache
**Date:** 2026-07-17

## Goal

Close the Low-priority backlog from Loop 001's Next Loop notes. Each item
needed a decision (not a mechanical fix), so investigated all four before
implementing to confirm the premise held up.

## Files Reviewed

- `nest/cache.module.ts`, `libs/database/src/module/database-core.module.ts`,
  `libs/queue/src/queue.module.ts` (to confirm the `@Global()` precedent and
  check whether anything outside `AppModule` currently depends on cache
  injection)
- `core/cache-options.ts`, `core/cache-entry.ts` (dead-code confirmation via
  grep for any producer/consumer)
- `caches/redis.cache.ts`, `src/redis/ioredis-client.adapter.ts` (Redis
  `clear()`/enumeration limitation, and whether ioredis exposes `SCAN`/
  `UNLINK`)
- `nest/cache.interceptor.ts` (the `@Cacheable`+`@CachePut`/`@CacheEvict`
  stacking bug)
- `core/is-statistics-aware-cache.ts` / barrel symmetry (trivial, folded in)

## Problems Found / Investigated

**Confirmed as real, not just style**
- `CacheModule` was a plain `@Module({})` — not `@Global()`, unlike
  `DatabaseCoreModule`/`QueueModule`. Confirmed via grep that nothing in
  `src/` outside `AppModule` currently injects cache providers, meaning the
  gap has been consequence-free so far — but any future feature module that
  tried would fail to resolve `CACHE_MANAGER`/`CacheService`, and
  re-importing `CacheModule.forRoot()` a second time to work around it would
  create a broken second registry with empty options. This was a latent bug
  waiting for the first real consumer, not a style nit.
- `core/cache-options.ts`'s `CacheOptions` and `CacheEntry.metadata`/`.size`:
  confirmed zero producers and zero consumers anywhere in the lib via grep
  (only self-referencing export statements). `libs/cache` has no
  `package.json` (unlike `libs/workflow`), so it's internal-only — no
  external package consumer could be relying on either.
- Redis `clear()`/`keys()`/`values()`/`entries()`/`size()` always rejecting:
  confirmed `IoRedisClientAdapter` (the app's real client) sits on top of
  ioredis, which natively supports both `SCAN` (cursor-based enumeration)
  and `UNLINK` — so a namespace-scoped implementation was actually
  buildable, not just theoretically nice-to-have.
- `@Cacheable` + `@CachePut`/`@CacheEvict` stacking: confirmed by reading
  `cache.interceptor.ts` that a cache HIT returns the cached value via
  `from(Promise.resolve(cached))`, completely bypassing the `execute()`
  wrapper that applies put/evict side effects — those only ever ran on a
  miss. Zero code in this repo currently stacks these decorators, so
  today's blast radius is zero, but it's a real footgun.

## Changes Made

- `CacheModule`: added `@Global()` class decorator plus `global: true` on
  both `forRoot`/`forRootAsync` DynamicModule returns (matching
  `QueueModule`'s belt-and-suspenders pattern exactly).
- Deleted `core/cache-options.ts` (and its barrel export); removed
  `CacheEntry.metadata`/`.size` fields.
- Added the missing `export * from './core/is-statistics-aware-cache'`
  barrel entry (symmetry with the already-exported `is-metadata-aware-cache`).
- `RedisClient` gained optional `scan`/`unlink` methods. `RedisCacheStore`:
  - New private `scanNamespaceKeys()` — paginates `SCAN` across cursors,
    matching only this cache's own `namespace:*` prefix.
  - `clear()` now `UNLINK`s the scanned keys when both `scan`/`unlink` are
    present, and only then — otherwise still rejects with an explanatory
    error naming the missing capability.
  - `keys()`, `values()`, `entries()`, `size()` similarly switch from
    always-reject to SCAN-backed implementations when available.
  - `IoRedisClientAdapter` (`src/redis/`) now implements both, wiring the
    real app's Redis-backed caches up to the new capability.
- `CacheInterceptor.intercept`: extracted `applyPutEvict(result)`, called
  both from the miss path (`execute()`, unchanged behavior) and now also
  from the `@Cacheable` hit path (previously skipped entirely). The
  underlying handler still never re-runs on a hit — only the put/evict side
  effects now fire consistently regardless of hit/miss.
- New/extended tests: `redis.cache.spec.ts` gained a
  `scoped SCAN+UNLINK when the client supports it` block (7 tests: cursor
  pagination, values/entries composition, size, clear with/without keys to
  delete, and the still-rejects-when-only-half-supported case);
  `cache.interceptor.spec.ts` gained 2 regression tests proving evict fires
  on both a `@Cacheable` miss and hit without re-invoking the handler;
  `cache.module.spec.ts` gained 3 regression tests proving `@Global()`
  actually makes cache providers injectable from a feature module that
  never imports `CacheModule`.

## Why

- All four items were investigated rather than assumed, per the "needs a
  decision, not just a mechanical fix" framing carried over from Loop 1 —
  in each case the investigation confirmed the fix was both safe and
  valuable, so all four were implemented per the (recommended-option)
  answers given.
- The Redis SCAN+UNLINK design deliberately stays scoped to the cache's own
  namespace prefix — the whole point of Loop 1's original all-reject
  behavior was avoiding a `FLUSHDB`-style blast radius across tenants/other
  caches sharing the same Redis instance; this preserves that safety
  property while making the methods actually usable.
- The interceptor fix intentionally still skips re-invoking the wrapped
  handler on a `@Cacheable` hit — only extended so put/evict side effects
  apply consistently, since re-running business logic on a cache hit would
  defeat the purpose of `@Cacheable` entirely.

## Tests

`libs/cache` suite is now 13 spec files / 151 tests (up from 140). Full
monorepo suite: 95 suites / 748 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` exists for this library yet.
- Redis/Memory TTL precision mismatch (Redis rounds to whole seconds via
  `Math.ceil(ttlMs / 1000)`, `MemoryCache` uses millisecond precision) —
  still just noted, not documented or changed this loop.

## Next Loop

- Document (or reconsider) the Redis/Memory TTL precision mismatch.
- No Critical/High findings open. `libs/cache` is now at the same stopping
  point as `libs/queue`/`libs/workflow` — remaining work is polish rather
  than defect-driven. `libs/database` still has its own deferred Next Loop
  items (`Symbol.for` token risk, `RepositoryResolver` dead methods,
  `CursorPagination` types) if the loop continues there next.

# Loop 003

**Library:** libs/cache
**Date:** 2026-07-22

## Goal

Fresh, adversarial Phase 1/2 pass over the whole library (all 45 source
files under `libs/cache/src`, plus the app's real wiring in
`apps/server/src/app.module.ts` and `apps/server/src/redis/ioredis-client.adapter.ts`
for consumption context) with special attention to ci.loop §9's Caching
Rules — mutation-through-reference, eviction correctness, multi-level
registry ordering, Redis reply coercion, global interceptor side effects,
composite key collision, multi-tenant isolation — most of which were
already closed in Loops 1-2. Goal was to find one more genuinely real,
justified issue rather than rubber-stamp the library clean, and only fix
it if it survived scrutiny.

## Files Reviewed

- All files under `libs/cache/src/**` (root-level manager/registry/
  factory/validator/constants, `caches/`, `clocks/`, `core/`, `interfaces/`,
  `nest/`, `policies/`, `storage/`, `utils/`) plus `index.ts` and every
  existing `.spec.ts`.
- `apps/server/src/app.module.ts` (`CacheModule.forRootAsync` wiring: one
  `redis` cache namespaced `'app'`, one `memory` L1, one `multi-level`
  composing them) and `apps/server/src/redis/ioredis-client.adapter.ts`
  (the real `RedisClient` implementation) for how the lib is actually
  consumed — read-only, not edited per task constraints.
- Re-verified (not re-fixed) that Loop 1/2's closed items are still closed:
  `MemoryCache`/`MemoryCacheStorage` clone semantics, `MultiLevelCache`
  `getWithMetadata`, `@Global()` registration, `useExisting`/`useClass`,
  Redis SCAN+UNLINK-backed `clear()`/`keys()`/etc., `@Cacheable` +
  `@CachePut`/`@CacheEvict` stacking on both hit and miss paths.
- Replacement policies (`lru`/`lfu`/`fifo`/`mru`): traced `onSet`/`onGet`/
  `onDelete`/`evict()` against `MemoryCache.doSet`/`doDelete` to check for
  policy/store desync on eviction — none found (each eviction path removes
  from both the policy's tracking structure and the backing store exactly
  once, verified for all four policies).
- `MemoryCache`'s `writeLock` mutex: traced every `get`/`set`/`delete`/
  `getWithMetadata` call path for read-outside-lock races — found only
  benign eventual-consistency staleness (a `touch:false` read snapshot
  taken before entering the lock), not a correctness bug worth changing.

## Problems Found

**Critical**

- (none)

**High**

- (none)

**Medium**

- `CacheModuleValidator.validate()` never checked for Redis namespace
  collisions. `RedisCacheStore` keys are just `${namespace}:${key}` with no
  isolation beyond that string prefix, and `namespace` silently defaults to
  `'cache'` when omitted (`RedisCacheConfiguration.namespace` is optional,
  `CacheFactory.redis`'s parameter default is `'cache'`). Two `redis` cache
  entries in the same `caches: {}` map that reuse the same `RedisClient`
  and both omit (or both explicitly set the same) `namespace` would
  silently share one Redis keyspace: `cache-a.set('x', ...)` and
  `cache-b.get('x')` would see each other's data, and — worse — a
  namespace-scoped `clear()`/`SCAN`+`UNLINK` on one cache would delete the
  other cache's entries too, exactly the "composite key collision" /
  multi-tenant isolation failure ci.loop §9 calls out by name. Not
  currently triggered by `apps/server/src/app.module.ts` (only one `redis`
  cache is configured there), but nothing in the library stopped a future
  second `redis` cache entry from hitting this silently — the validator
  already catches structurally-unsafe configs (missing `defaultCache`,
  unknown `l1`/`l2` refs, multi-level cycles) at boot, so a silently
  colliding keyspace was a real, unguarded gap in that same safety net.

**Low**

- (none newly found this loop beyond what Loop 2 already deferred — see
  below.)

## Changes Made

- `cache.module.validator.ts`: added `validateRedisNamespaces`, called from
  `validate()` alongside the existing cycle check. Groups all `redis` cache
  configs by their `RedisClient` object reference, then within each group
  checks for a duplicate *effective* namespace (`config.options.namespace
  ?? 'cache'`) and throws a named, actionable error identifying both
  colliding cache names and the shared namespace. Deliberately scoped to
  "same client reference" rather than "same namespace string" globally —
  two `redis` caches pointed at genuinely different Redis servers can
  safely reuse the same namespace string (they don't actually share a
  keyspace), and the library has no way to detect "same server, different
  client object" from a bare `RedisClient` interface, so flagging that case
  would produce false positives. Reference-equality on the shared client is
  the one case that's both fully detectable and unambiguously unsafe.
- `cache.module.validator.spec.ts`: extended the `redisCache()` test helper
  to accept an explicit `client`/`namespace` (previously always built a
  fresh anonymous client with no namespace override), and added 4 new
  tests: rejects two same-client caches both defaulting to `'cache'`,
  rejects two same-client caches with an identical explicit namespace,
  accepts two same-client caches with distinct namespaces, accepts two
  different-client caches sharing the same (default) namespace.

## Why

- This is a direct, previously-unguarded instance of the exact risk
  category ci.loop §9 names ("Composite key collision risk", "Multi-tenant
  isolation") — not an invented or cosmetic finding. The fix is additive
  validation only (mirrors the existing `validateCycles`/`validateMultiLevel`
  pattern exactly), throws only for configs that were already silently
  broken (any app currently relying on two same-client, same-namespace
  redis caches was already experiencing data corruption, just undetected),
  and does not change the public API shape (`CacheModuleOptions`,
  `RedisCacheConfiguration` untouched) — so it's classified MEDIUM risk per
  ci.loop §18 (validation/caching-adjacent change, backward compatible for
  every correctly-configured app, including the real
  `apps/server/src/app.module.ts` config, which was re-verified to still
  pass validation unchanged).
- Everything else inspected this loop (replacement-policy/store desync,
  `writeLock` race windows, Loop 1/2's previously-closed items) held up
  under adversarial re-reading — per ci.loop §18, code that already
  satisfies correctness was deliberately left untouched rather than
  refactored for its own sake.

## Tests

`libs/cache` suite is now 13 spec files / 155 tests (up from 151). Full
monorepo suite: 133 suites / 1044 tests, all passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Document (or reconsider) the Redis/Memory TTL precision mismatch
  (`Math.ceil(ttlMs / 1000)` in `RedisCacheStore.set()` vs. millisecond
  precision in `MemoryCache`) — carried over from Loop 2, still not
  addressed. Investigated this loop only to the extent of confirming the
  rounding direction (always rounds *up*) is the safe one for the one
  security-sensitive consumer that exists today (`CacheAccessTokenDenylist`
  in `libs/auth`, riding on the `default` redis cache) — a denylist entry
  can only outlive its requested TTL by up to ~999ms, never expire early.
  Still worth an explicit doc comment next loop rather than leaving it
  tribal knowledge.
- No `ARCH.md` exists for this library yet.

## Next Loop

- Add the TTL-precision doc comment (or decide it's not worth one).
- No other Critical/High/Medium findings open as of this loop.

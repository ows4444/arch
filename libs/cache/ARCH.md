# Design 001

**Library / Bounded Context:** libs/cache (Caching Infrastructure)
**Date:** 2026-07-23

## Goal

Retroactively document `libs/cache`'s architecture, completing the same-day set with
`libs/database/ARCH.md` and `libs/queue/ARCH.md` Design 001 — the three shared libraries that
went through Improvement Loop passes (6 for this one) without a preceding Design Mode session.
This entry captures what was already built and this session's own findings, not a new decision.

## Scale/Team Context Assumed

Single maintainer, Nest monorepo. Backend-agnostic by design from the start — in-memory, Redis,
and a composed multi-level (L1 in-memory + L2 Redis) backend all coexist in the actual app config
(`apps/server/src/app.module.ts`'s `CacheModule.forRootAsync`: one Redis cache namespaced `'app'`,
one in-memory L1, one multi-level composing them as the `default` cache). No stated
throughput/latency target driving the multi-level composition specifically — it's used because a
hot local L1 in front of a shared Redis L2 is a standard pattern, not because a measured bottleneck
demanded it.

## Bounded Contexts Identified

- **Single bounded context: Caching Infrastructure.** A Generic Subdomain, same framing as
  `libs/database`/`libs/queue`: a named-instance cache registry with pluggable backends, owned by
  no business domain. `libs/auth`'s `CacheAccessTokenDenylist` and `libs/validation`'s
  `CachedValidationRuleStore` are the two concrete consumers, both constructed and injected by the
  *host app*, never by this library reaching into either — a deliberate inversion (see Context
  Map) that keeps this library from depending on anything it caches for.
- Does **not** own eviction *business* policy beyond the four generic algorithms
  (LRU/LFU/FIFO/MRU) — a consumer picks one per named cache; this library has no concept of what
  it's caching or why a given entry matters more than another.

## Context Map

- **Consumed by name, not by type.** `CacheManager.get/set/delete(cacheName, key, ...)` addresses
  caches by string name resolved from a `CacheRegistry` built from a declarative `caches: {}` map
  at `forRoot`/`forRootAsync` time — a consumer never imports a concrete `MemoryCache`/
  `RedisCacheStore` class, only the `CacheManager`/`CacheService`/`@Cacheable` decorator surface.
- **Type-only dependency on `@/cache` from consumers, never the reverse.** `libs/auth`'s
  `CacheAccessTokenDenylist` and `libs/validation`'s `CachedValidationRuleStore` both import only
  `CacheManager`'s *type* — the host app constructs and injects the actual instance
  (`AuthModule.forRoot({ accessTokenDenylist: new CacheAccessTokenDenylist(cacheManager) })`), so
  `libs/cache` never registers or depends on `AuthModule`/`ValidationModule` itself. Same pattern
  both consumers' own `ARCH.md` entries document independently.
- **Downstream of a host-supplied `RedisClient` port, not `ioredis` directly.** `RedisCacheStore`
  depends on a small `RedisClient` interface (`get`/`set`/`del`/`exists`/optional
  `pttl`/`scan`/`unlink`/`eval`); `apps/server/src/redis/ioredis-client.adapter.ts` is the one real
  implementation, kept in the host app rather than this library taking a direct `ioredis`
  dependency — the same anti-corruption-layer shape `libs/queue` uses for
  `amqp-connection-manager` versus a bare port, applied here specifically so a future
  Redis-client-library swap doesn't touch this library at all.

## Architecture Style Recommendation

Not applicable in the monolith/microservices sense. The one style-shaped decision: a **named
cache registry** (`CacheRegistry`, a `Map<string, Cache>`) rather than a single global cache
instance — chosen because the actual app needs multiple, differently-configured caches
simultaneously (a Redis-backed `'app'` cache, a lightweight in-memory L1, and a `multi-level`
composing both as `default`), and a registry-of-named-instances is the natural shape for that
without forcing every consumer through one shared, one-size-fits-all cache.

## Module Breakdown

- **`CacheModule`** (`@Global()` — Loop 002's fix, matching `DatabaseCoreModule`/`QueueModule`'s
  precedent; a plain empty static `@Module({})`, same dynamic-module gotcha every sibling avoids)
  — `forRoot`/`forRootAsync`, `useFactory`/`useClass`/`useExisting` (Loop 001's fix, mirroring
  `libs/database`'s own `DatabaseOptionsFactory` shape). Registers `CacheInterceptor` as a global
  `APP_INTERCEPTOR` by default (`registerInterceptor: false` opts out).
- **`CacheModuleValidator`** — boot-time structural checks over the declarative `caches: {}` map:
  missing `defaultCache`, unknown `l1`/`l2` references, multi-level self-reference, multi-level
  cycles (DFS-based), and — Loop 003's fix this library's own history — same-Redis-client
  namespace collisions (two `redis` cache entries sharing both a client reference and an effective
  namespace would silently share one keyspace; caught at boot rather than corrupting data at
  runtime).
- **`CacheRegistry`** — the named-instance map (`register`/`get`/`has`/`unregister`/`clear`/
  `names`/`values`), built once at module-init time by `CacheFactory` walking the declarative
  config (recursively, for `multi-level` entries composing other named caches).
- **`CacheFactory`** — `memory()`/`redis()`/`multiLevel()` static constructors, wiring each
  backend's plugins/serializer/clock/replacement-policy.
- **`caches/`** — `MemoryCache` (in-memory, pluggable `ReplacementPolicy`, injectable `Clock` for
  deterministic tests, opt-in `cloneValues` to isolate the cache from caller-held mutable
  references — Loop 001's fix for the mutation-through-reference bug class), `RedisCacheStore`
  (namespace-prefixed keys, `SCAN`+`UNLINK`-backed `clear()`/`keys()`/etc. when the client supports
  it, otherwise an explanatory rejection rather than the old always-reject default), `MultiLevelCache`
  (composes two named caches as L1/L2, promotes an L2 hit into L1 preserving TTL via
  `getWithMetadata` — Loop 001's fix for TTL-dropping when a multi-level cache nests inside
  another multi-level cache's L2).
- **`policies/`** — `LruPolicy`/`LfuPolicy`/`FifoPolicy`/`MruPolicy`, each independently
  implementing `onGet`/`onSet`/`onDelete`/`onClear`/`evict()` against `MemoryCache`'s eviction
  hook — no shared base class, since the four algorithms' actual bookkeeping (linked-list splice
  for LRU/MRU, frequency+insertion-order for LFU, plain queue for FIFO) doesn't share enough
  structure to justify one.
- **`nest/`** — `CacheService<K,V>` (a thin single-cache-instance wrapper, for a consumer that only
  ever needs one named cache injected directly), `CacheInterceptor` + `@Cacheable`/`@CachePut`/
  `@CacheEvict` decorators (method-level caching; a `@Cacheable` cache *hit* still applies any
  stacked `@CachePut`/`@CacheEvict` side effects — Loop 2's fix for the bug class where stacking
  these decorators silently skipped put/evict on the hit path).
- **`core/`** — `SingleFlight` (collapses concurrent duplicate loads for the same key — the
  mechanism behind `CacheManager.getOrLoad`'s stampede protection), `CacheSerializer`/plugin
  interface (`beforeGet`/`afterGet`/etc. hooks with a configurable error handler, so a
  misbehaving metrics/logging plugin can't abort the cache operation or block other plugins).

## Aggregate Design

Not applicable in the DDD business-aggregate sense. The closest analogue is a single
`CacheEntry<V>` (`value`, `createdAt`/`updatedAt`/`accessedAt`/`accessCount`, `expiresAt`/`ttl`) —
owned entirely by whichever backend created it (`MemoryCacheStorage`'s `Map`, or Redis's own
key-value store), never shared or referenced across cache instances.

## Domain Model

- **`CacheEntry<V>`** — see Aggregate Design.
- **`CacheStatistics`** (`hits`/`misses`/`writes`/`deletes`/`evictions`/`expirations`/`errors`) —
  per-cache-instance counters, correctness of which matters as observability data (Loop 005 this
  session: `RedisCacheStore.values()`/`entries()` were inflating `hits`/`misses` and refiring
  plugin hooks by calling the public `get()` internally for enumeration — fixed by routing through
  a private `getRaw()` that skips stats/plugin side effects entirely).
- **`DataSourceStatus`-equivalent:** none — a cache entry is either present-and-unexpired or
  absent; there's no intermediate "reconnecting" state the way `libs/database`'s `DataSourceState`
  has, since a cache backend being unreachable is just a rejected promise, not a tracked status.
- **`ReplacementPolicy<K>`** — the eviction-decision interface every one of the four policies
  implements; see Module Breakdown.

## Commands / Queries / Events

Not applicable as a formal split — `get`/`set`/`delete`/`getOrLoad` are the entire command/query
surface, and there's no domain event publisher (unlike `libs/workflow`'s `WORKFLOW_EVENT_PUBLISHER`).
The plugin interface's `before*`/`after*` hooks are the closest thing to "events," and they're
synchronous, in-process hooks, not a pub/sub mechanism.

## Engines / Policies / Specifications

- **Replacement policies** — see Module Breakdown; four fixed algorithms, not a pluggable rule
  engine, matching what every actual consumer needs today.
- **`SingleFlight`** — a concurrency-collapsing mechanism (not a policy in the eviction sense):
  `CacheManager.getOrLoad`'s double-checked-locking (`get` → miss → `singleFlight.do(key, loader)`
  → re-check `get` inside the lock → call the loader) — the dedup key is `JSON.stringify([cache,
  key])`, deliberately not naive string concatenation, since JSON-escaping guarantees no
  cross-cache-name collision the way a bare `${cache}:${key}` could.

## Workflows / Sagas

Not applicable — no multi-step business process; caching is a pure read/write side-effect
mechanism other libraries use, not something with its own saga/compensation logic.

## Data Architecture

Backend-agnostic by construction (see Architecture Style Recommendation) — in-memory (process-local,
non-durable), Redis (shared, durable within Redis's own persistence config), or a composed
multi-level of any two named caches (including nesting a `multi-level` cache as another
`multi-level` cache's L2, which `getWithMetadata`'s TTL-preserving promotion path exists
specifically to support correctly). No single "the" cache datastore — the actual topology is
whatever the host app's declarative `caches: {}` map says.

## Messaging Architecture

Not applicable — no broker dependency; the plugin interface is in-process only.

## Reliability Architecture

- **Mutation-through-reference is an opt-in-protected, not default-protected, concern.**
  `MemoryCache`'s default behavior hands out and stores the same object reference a caller used —
  mutating a returned value mutates the cached entry with no `set()` call. `cloneValues: true`
  (via `structuredClone`) isolates the cache from the caller, but is opt-in rather than default-on
  specifically because `structuredClone` silently strips class prototypes — a cached TypeORM
  entity would lose its class identity/methods under default-on cloning, a real cost for a
  monorepo with heavy ORM entity usage. This was a deliberate tradeoff made explicitly with the
  user (Loop 001), not something to silently default one way.
- **Redis-backed bulk operations (`clear`/`keys`/`values`/`entries`/`size`) are namespace-scoped
  by construction, never broad.** `RedisCacheStore` uses `SCAN`+`UNLINK` restricted to its own
  `namespace:*` prefix when the injected `RedisClient` supports both — deliberately never a
  `FLUSHDB`-style operation, since the whole point is avoiding blast radius across other caches/
  tenants sharing the same Redis instance (Loop 002's fix, upgrading from an always-reject
  default once `IoRedisClientAdapter` was confirmed to support both primitives).
- **Redis namespace collisions are caught at boot, not discovered at runtime as data
  corruption.** `CacheModuleValidator.validateRedisNamespaces` groups `redis` cache configs by
  client-object-reference and rejects two configs that would share both a client and an effective
  namespace (Loop 003) — deliberately scoped to "same client reference," not "same namespace
  string globally," since two `redis` caches pointed at genuinely different Redis servers can
  safely reuse a namespace string without actually colliding.
- **Enumeration must not pollute observability statistics.** `RedisCacheStore.values()`/`entries()`
  used to call the cache's own public `get()` per key for enumeration, which is the same method
  application code calls for real reads — inflating `hits`/`misses` and refiring metrics/logging
  plugins as if each enumerated key were a genuine application read (this session's Loop 005 fix,
  routing through a private `getRaw()` with no stats/plugin side effects). `MemoryCache`'s
  equivalent methods never had this problem (they read straight from the backing store), so this
  was a Redis-specific inconsistency, not a design invariant either backend violated on purpose.
- **`SingleFlight`'s dedup key must be collision-proof across cache names, not just within one.**
  `JSON.stringify([cache, key])` rather than `${cache}:${key}` — the same collision-avoidance
  reasoning behind every composite-key fix found elsewhere this session (`libs/queue`'s inbox,
  `libs/ratelimit`'s rate-limit key), applied here from the start rather than needing a later fix.

## Security Architecture

- **Multi-tenant isolation via namespace scoping**, not access control — see Reliability
  Architecture's Redis bulk-operation scoping. This library has no concept of "tenant" or
  "caller identity"; namespace-per-named-cache is the only isolation primitive, and it's the
  consumer's responsibility to pick namespaces that don't collide (backstopped by boot-time
  validation for the one detectable case — same client, same effective namespace).
- **No authN/authZ surface** — same posture as `libs/database`/`libs/queue`: any in-process caller
  with a reference to a `CacheManager`/named cache can read/write it freely.
- **Secret handling** — connection details for the Redis client live entirely in the host app's
  `RedisClient` implementation (`IoRedisClientAdapter`); this library never sees or logs
  credentials.

## Folder Structure

Matches Module Breakdown: `caches/`, `clocks/` (`SystemClock`/`FakeClock`, injectable time source
for deterministic TTL tests), `core/`, `interfaces/`, `nest/`, `policies/`, `storage/`
(`MemoryCacheStorage`, the backing `Map` `MemoryCache` delegates to), `utils/` (the JSON
serializer), plus root-level `cache-manager(.impl).ts`/`cache-registry.ts`/`cache.factory.ts`/
`cache.module.validator.ts`/`cache.constants.ts` and a single barrel `index.ts`. Flat,
concern-named top level, same convention as `libs/database`/`libs/queue`.

## Deployment Architecture

No independent deployment surface — a library consumed in-process by `apps/server`/`apps/worker`.
The actual app's cache topology (one Redis-backed `'app'` cache, one in-memory L1, one
`multi-level` `default` composing them) is declared once in `apps/server/src/app.module.ts` and
validated at boot before any provider resolves.

## Team Ownership Model

Not applicable — single maintainer.

## Tradeoff Analysis

- **Opt-in `cloneValues` vs. default-on cloning.** See Reliability Architecture — the explicit
  tradeoff (reference-sharing footgun vs. `structuredClone`'s prototype-stripping) was surfaced to
  and decided by the user rather than picked silently, since either default has a real cost for
  some consumer.
- **Redis SCAN+UNLINK scoped to the client-reference level, not global namespace uniqueness.**
  Accepts that two `redis` caches on genuinely different Redis servers can share a namespace
  string safely — validating "same namespace string" globally would produce false positives for
  that legitimate case, so the check is deliberately narrower than "no two caches should ever
  share a namespace."
- **No shared base class across the four replacement policies**, despite the four implementing an
  identical interface — judged that LRU/MRU's linked-list splice, LFU's frequency+insertion-order
  tracking, and FIFO's plain queue don't share enough real structure to justify one, versus forcing
  a premature abstraction across genuinely different bookkeeping shapes.

## Future Scalability Plan

Not applicable in detail given no stated scale target. The `multi-level` composition itself is
this library's built-in answer to "reduce load on a shared Redis instance" — add an in-memory L1
in front of any existing Redis-backed cache, no code change needed beyond the declarative config.

## Open Questions

- None outstanding — every open item from `LOOP.md`'s history is either closed or explicitly
  deferred pending a concrete driving need (most recently two consecutive clean adversarial passes
  this session, Loops 5-6).

## Handoff to Improvement Loop

- **Public API surface:** `libs/cache/src/index.ts`'s barrel — `CacheModule`, `CacheManager`/
  `CacheService`, `@Cacheable`/`@CachePut`/`@CacheEvict`, `CacheFactory`, the four replacement
  policies, `Clock`/`SystemClock`/`FakeClock`, `CachePlugin`/`CacheSerializer` interfaces,
  `RedisClient` port.
- **Module boundaries:** as described under Module Breakdown — unchanged from what's already
  implemented; this entry documents, not proposes, the boundary.

---

## Executive Summary

`libs/cache` is a backend-agnostic, named-instance cache registry — in-memory, Redis, or a
composed multi-level of either — consumed by name (`CacheManager.get/set/delete(cacheName, ...)`)
rather than by concrete backend type, with `libs/auth`/`libs/validation` as its two real consumers,
both wired by the host app rather than this library depending on either. Its architecture is
almost entirely about two things: making a handful of generic backend behaviors (eviction,
TTL, namespacing) pluggable without leaking backend-specific detail to consumers, and keeping
observability (`CacheStatistics`) and isolation (Redis namespace scoping) correct under the
backends' actual failure/enumeration semantics rather than just their happy path. Six Improvement
Loop passes have found and fixed real defects concentrated in exactly those two concerns: a
mutation-through-reference bug in the in-memory backend, a TTL-dropping bug when multi-level
caches nest, a Redis namespace-collision gap now caught at boot, and — this session — Redis
enumeration silently inflating hit-rate statistics. Two consecutive clean adversarial passes this
session (Loops 5-6) found nothing further, leaving the library at a genuine stopping point rather
than one assumed without re-checking.

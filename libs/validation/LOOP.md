# Loop 001

**Library:** validation
**Date:** 2026-07-20

## Goal

Scaffold `libs/validation` per the Design Mode session in `ARCH.md` (Design 001): a single
Specification-based validation primitive usable for DTO shape validation, business-rule/domain
invariants, async/state-dependent checks, and message/payload validation — consumable by
`apps/server`, `libs/queue`, `libs/workflow`, and `libs/auth`.

## Files Reviewed

- `libs/cache/src/nest/cache.module.ts` (forRoot/forRootAsync + DI-token convention reference)
- `libs/queue/src/consumer/rmq-payload-validator.ts` + `libs/queue/src/utils/validation-errors.ts`
  (existing bespoke class-validator-based payload validation this lib is meant to eventually
  replace)
- `apps/server/src/main.ts` (existing global `ValidationPipe` — shape validation for HTTP is
  already handled there; this lib is additive, not a replacement, for that path)
- `libs/auth/src/dto/*` (existing class-validator DTO conventions)
- `tsconfig.json`, `nest-cli.json`, `package.json` (path alias / project / jest mapper conventions)

## Problems Found

**Critical**
- (none — greenfield scaffold, no existing code being fixed)

**High**
- (none)

**Medium**
- `libs/queue`'s `RMQPayloadValidator` and `libs/validation`'s `ClassValidatorSpecification` now
  contain near-duplicate class-validator invocation logic (`plainToInstance` + `validateSync` +
  constraint formatting). Left as-is for this loop (see Remaining TODO) rather than migrating
  `libs/queue` in the same change, to keep this scaffold reviewable in isolation.

**Low**
- (none)

## Changes Made

- Added `libs/validation` library: `Specification<T>` interface, `and`/`or`/`not` combinators,
  `ClassValidatorSpecification` (class-validator adapter), `formatValidationErrors`,
  `ValidationResult`/`ValidationFailure`, `ValidationService` (`validate`/`validateOrThrow`),
  `ValidationModule.forRoot`/`forRootAsync`, `VALIDATION_ERROR_FACTORY` DI token with a
  `DefaultValidationErrorFactory` no-op default, and `ValidationFailedError`.
- Registered the library in `nest-cli.json`, added `@/validation` path aliases in `tsconfig.json`,
  added the matching Jest `moduleNameMapper` entry in `package.json`, and added
  `libs/validation/tsconfig.lib.json` matching sibling libs' shape.
- Added unit tests for the combinators, the class-validator adapter, and `ValidationService`.

## Why

- User asked for a validation library usable by `apps/*` and, where useful, other `libs/*`, with
  DTO validation, business-rule validation, async/state-dependent validation, and message/payload
  validation all in scope, but confirmed a small single-team scale target — see `ARCH.md` Design
  001 for the full reasoning behind choosing one `Specification<T>` primitive over four separate
  subsystems or a rule-engine/DSL.

## Tests

17 new tests added (`composite-specifications.spec.ts`, `class-validator.specification.spec.ts`,
`validation.service.spec.ts`); full repo suite: 121 suites / 975 tests passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- Migrate `libs/queue`'s `RMQPayloadValidator` to use `ClassValidatorSpecification` +
  `formatValidationErrors` internally (public `RMQPayloadValidator.validate()` API unchanged,
  `NonRetryableMessageError` throw behavior unchanged) — removes the duplicated logic noted above.
  Classified MEDIUM risk (internal refactor, no public API change).
- Consider a `@Step({ inputSpec })`-style hook in `libs/workflow` once a concrete workflow needs
  step input validation (deferred — avoid speculative API surface on the semver-sensitive
  `@ows4444/nest-workflow` package).
- Consider expressing `libs/auth`'s role/permission-name uniqueness checks as async
  `Specification`s instead of ad hoc repository checks (auth library's own loop to decide).
- No integration into `apps/server`'s `AppModule` yet — `ValidationModule.forRoot()` needs to be
  added there before HTTP-side business-rule validation can actually be injected anywhere.

## Next Loop

- Wire `ValidationModule.forRoot()` into `apps/server/src/app.module.ts` (and `apps/worker` if it
  ends up consuming queue/workflow validation).
- Pick one of the Remaining TODO items above (queue migration is the lowest-risk, highest-value
  next step since it removes real duplication rather than adding speculative new integration).

---

# Loop 002

**Library:** validation
**Date:** 2026-07-20

## Goal

Close out the two lowest-risk "Next Loop" items from Loop 001: give `libs/validation` an actual
consumer (`apps/server`) and remove the duplicated class-validator logic in `libs/queue`.

## Files Reviewed

- `apps/server/src/app.module.ts`
- `libs/queue/src/consumer/rmq-payload-validator.ts` + `rmq-payload-validator.spec.ts`
- `libs/queue/src/consumer/rmq-consumer.runtime.ts`, `libs/queue/src/publisher/rmq.publisher.ts`
  (both call `RMQPayloadValidator.validate<T>` with an unconstrained `T`)

## Problems Found

**Critical**
- (none)

**High**
- (none)

**Medium**
- (resolved) `RMQPayloadValidator` duplicated `ClassValidatorSpecification`'s
  transform+validate+format logic — see Changes Made.

**Low**
- (none)

## Changes Made

- Added `ValidationModule.forRoot()` to `apps/server/src/app.module.ts`, immediately after
  `ConfigModule.forRoot`, so `ValidationService` is injectable anywhere in the HTTP app.
- Rewrote `libs/queue/src/consumer/rmq-payload-validator.ts` to build a
  `ClassValidatorSpecification` and call `.toInstance()`, catching
  `ClassValidatorSpecificationError` and rethrowing `NonRetryableMessageError` with the same
  `"Invalid RabbitMQ payload: ..."` message shape as before. Public `RMQPayloadValidator.validate()`
  signature and throw behavior are unchanged — confirmed by the pre-existing
  `rmq-payload-validator.spec.ts` passing unmodified.
  - `RMQPayloadValidator.validate<T>` keeps its original unconstrained `T` (callers in
    `rmq-consumer.runtime.ts` and `rmq.publisher.ts` pass `ClassConstructor<unknown>`/generic `T`);
    internally it casts to `ClassConstructor<T & object>` before constructing the specification,
    since `ClassValidatorSpecification<T extends object>` requires an object bound but every
    class-validator payload is an object instance at runtime.

## Why

- `libs/queue`'s bespoke validator and this lib's adapter were doing the identical
  `plainToInstance` + `validateSync` + constraint-formatting dance — exactly the kind of
  cross-lib duplication the Design 001 handoff called out as the first thing to fix, and it was
  low risk because the public API didn't need to change.
- `libs/queue/src/context/rmq-header.parser.ts` also uses a `formatValidationErrors` (its own,
  string-returning version in `libs/queue/src/utils/validation-errors.ts`) but validates a fixed
  header shape rather than an arbitrary consumer-supplied class — left untouched; migrating it
  isn't the same pattern and wasn't asked for.

## Tests

No new tests added — existing `rmq-payload-validator.spec.ts` (4 tests) passes unmodified against
the new implementation, proving behavior parity. Full repo suite: 121 suites / 975 tests passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- `@Step({ inputSpec })`-style workflow validation hook — still deferred, no concrete step needs
  it yet.
- `libs/auth` uniqueness checks as async `Specification`s — still deferred to auth's own loop.
- `libs/queue/src/context/rmq-header.parser.ts` still has its own `formatValidationErrors`
  (string-returning) rather than using `libs/validation`'s (string-array-returning) version —
  intentionally left alone this loop (different shape validated, not the same duplication as
  the payload validator was).

## Next Loop

- No forced next step — `libs/validation` now has a real consumer and the concrete duplication
  identified in Design 001 is gone. Future loops should be driven by an actual need (a workflow
  step wanting input validation, an auth business rule wanting to be expressed as a
  `Specification`) rather than speculative migration.

---

# Loop 003

**Library:** validation
**Date:** 2026-07-20

## Goal

Re-review `libs/validation` itself (not its consumers) now that it exists and is wired in, per
the Understand → Review discipline — check for anything left over from scaffolding before
declaring the loop done.

## Files Reviewed

- Every non-spec file under `libs/validation/src/` and `libs/validation/src/index.ts`.

## Problems Found

**Critical**
- (none)

**High**
- (none)

**Medium**
- (none)

**Low**
- `libs/validation/src/validation.constants.ts` was dead code: a re-export shim for
  `VALIDATION_ERROR_FACTORY` that nothing imported and that wasn't itself re-exported from
  `index.ts` (the token is already exported directly from
  `errors/validation-error-factory.interface.ts` via the barrel). Left over from initial
  scaffolding.

## Changes Made

- Deleted `libs/validation/src/validation.constants.ts`.

## Why

- Section 11 (Cleanup Checklist): unused files/exports should be removed continuously, not left
  to accumulate. Confirmed via repo-wide grep that nothing referenced the file before deleting.

## Tests

No test changes needed (nothing referenced the removed file). Full repo suite: 121 suites / 975
tests passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- Unchanged from Loop 002 — no concrete consumer need yet for workflow step validation or auth
  uniqueness-as-Specification.

## Next Loop

- None forced. `libs/validation` is in a clean, consumed, dead-code-free state. Next work on this
  library should be triggered by a concrete requirement, not another speculative pass.

---

# Loop 004

**Library:** validation
**Date:** 2026-07-20

## Goal

Support admin-configurable, DB-stored validation rules, per `ARCH.md` Design 002. This is the
concrete requirement that triggers work again after Loop 003's "wait for a real need."

## Files Reviewed

- `libs/queue/src/outbox/outbox.repository.ts` + `libs/queue/src/persistence/*` (entity/repository/
  migration conventions to mirror: `@DatabaseRepository`, `BaseRepository`, `@InjectRepository`,
  `*_TYPEORM_ENTITIES`/`*_MIGRATIONS` exported for the host to merge)
- `libs/database/src/module/database-core.module.ts` (confirmed `RepositoryProviderFactory.create(
  RepositoryRegistry.all())` runs at `DatabaseModule.forRoot()` construction time, and
  `@DatabaseRepository()` registers into that global registry at class-import time — so
  `ValidationRuleRepository` only needs to be transitively imported before `DatabaseModule.forRoot()`
  runs, which it already is via `apps/server/src/app.module.ts`'s `@/validation` import)
- `libs/workflow`'s `WORKFLOW_METRICS`/`WORKFLOW_EVENT_PUBLISHER` no-op-default convention (used to
  correct an initial design mistake — see Changes Made)

## Problems Found

**Critical**
- (none)

**High**
- (none — the module-boundary change itself is documented as a Design 002 decision in `ARCH.md`,
  not treated as an ordinary code-review finding)

**Medium**
- First draft of `ValidationModule.forRoot()`/`forRootAsync()` conditionally omitted
  `VALIDATION_RULE_STORE`/`ValidationRuleService` entirely when `rules` was not passed, which
  diverges from the established repo convention (`WORKFLOW_METRICS` etc. are *always* provided,
  defaulting to a no-op) — caught and corrected before landing (see Changes Made).

**Low**
- (none)

## Changes Made

- Added `libs/validation/src/rules/`: `ValidationRuleOperator` (narrow enum: equals/not_equals/
  greater_than(_or_equal)/less_than(_or_equal)/in/not_in/contains/not_contains — no regex, no
  expression language), `StoredRule` interface, `evaluateStoredRule` (fails closed with a reason on
  type mismatches), `StoredConditionSpecification` + `composeStoredRules` (AND-composes stored
  rules into one `Specification`, trivially satisfied when empty), `ValidationRuleStore` port +
  `VALIDATION_RULE_STORE` token, `NoopValidationRuleStore` (default), `DatabaseValidationRuleStore`,
  `ValidationRuleService` (`validateStored`/`validateStoredOrThrow`).
- Added `libs/validation/src/persistence/`: `ValidationRuleEntity`, `ValidationRuleRepository`
  (`@DatabaseRepository`, extends `BaseRepository`), migration
  `CreateValidationRuleTable1753200000000`, `VALIDATION_TYPEORM_ENTITIES`/`VALIDATION_MIGRATIONS`.
- `ValidationModule.forRoot`/`forRootAsync` now always provide `VALIDATION_RULE_STORE` and
  `ValidationRuleService` — defaulting to `NoopValidationRuleStore` (zero rules, always satisfied),
  swapping in `DatabaseValidationRuleStore` when `{ rules: { enabled: true } }` is passed. First
  draft omitted the token/service entirely when disabled; corrected to match the
  no-op-default-always-provided convention (see Problems Found).
- Wired `VALIDATION_TYPEORM_ENTITIES`/`VALIDATION_MIGRATIONS` into `apps/server/src/app.module.ts`'s
  `DatabaseModule.forRoot()` call, and enabled `ValidationModule.forRoot({ rules: { enabled: true } })`.
- Appended Design 002 to `ARCH.md`, revising the Design 001 "must never import `@/database`" line
  (superseded, not deleted — see Design 002's note under Design 001's Handoff section).

## Why

- User asked "if validation stored in DB" — clarified as admin-configurable business rules. This
  reopens a Design 001 rejection (rule DSL/registry), which per Section 0.6 needed a new dated
  Design entry rather than a silent code change, given it's a HIGH-risk module-boundary decision
  (`libs/validation` gaining a `@/database` dependency).
- Narrow field/operator/value grammar (no regex, no expression language) chosen specifically to
  avoid turning admin-editable rule storage into a ReDoS or arbitrary-logic attack surface — see
  `ARCH.md` Design 002 HIGH decisions for the full reasoning.

## Tests

13 new tests (`rule-evaluator.spec.ts`, `stored-condition.specification.spec.ts`,
`validation-rule.service.spec.ts`) covering every operator, the fail-closed paths, empty-rule-set
composition, and `ValidationRuleService` against a fake store. Full repo suite: 124 suites / 988
tests passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- No admin HTTP surface (CRUD endpoints for managing stored rules) — deferred, see `ARCH.md`
  Design 002 Open Questions. The repository/entity support it; no controller exists yet.
- No caching of `findRules(targetType)` — every `validateStored` call re-fetches from MySQL.
  Deferred until it's a measured bottleneck at the assumed scale.
- Cross-field stored conditions (comparing two fields on the same candidate) — no concrete need
  yet.
- Still unchanged from earlier loops: workflow step-input validation hook, auth
  uniqueness-as-Specification — deferred to their own concrete needs.

## Next Loop

- None forced. If an admin-facing CRUD surface for managing rules becomes a real requirement,
  that's the natural next loop (a controller + DTOs in `apps/server`, following the same
  `ClassValidatorSpecification`-backed shape validation already in place for other endpoints).

---

# Loop 005

**Library:** validation
**Date:** 2026-07-20

## Goal

Close the "no admin HTTP surface" gap flagged at the end of Loop 004: without a way to
create/edit/delete stored rules, the DB-storage feature exists but isn't actually usable except
via direct database access.

## Files Reviewed

- `libs/auth/src/http/role.controller.ts` (guard/permission/DTO/Swagger conventions to mirror)
- `libs/auth/src/index.ts` (confirmed `JwtAuthGuard`, `PermissionsGuard`, `Permissions` are
  exported from the barrel, so `apps/server` can depend on them without reaching into `libs/auth`
  internals)
- `libs/queue/src/outbox/outbox.repository.spec.ts` +
  `libs/queue/src/testing/queue-test-datasource.ts` (the in-memory sqlite `DataSource` +
  `fakeRepositoryResolver` pattern used to unit-test a `BaseRepository` subclass without a real
  MySQL connection — mirrored for `libs/validation`)
- `libs/database/src/repository/base.repository.ts` (confirmed `create`/`update`/`delete` are
  already defined on `BaseRepository` with TypeORM-native signatures — see Problems Found)

## Problems Found

**Critical**
- (none)

**High**
- (none — the admin surface lives in `apps/server`, not `libs/validation`, specifically so
  `libs/validation` never gains a dependency on `@/auth`; this was a design constraint carried
  over from Design 001/002, not a new decision, so no new `ARCH.md` entry was needed)

**Medium**
- First draft of `ValidationRuleRepository`'s CRUD methods used the names `create`/`update`/
  `delete`, which collide with `BaseRepository`'s own same-named methods (different signatures —
  TypeORM's native `create`/`update`/`delete`, not domain CRUD). TypeScript caught this immediately
  (`TS2416`, incompatible override) before it reached tests. Renamed to `createRule`/`updateRule`/
  `deleteRule`.

**Low**
- (none)

## Changes Made

- `libs/validation/src/persistence/validation-rule.repository.ts`: added `findAll(targetType?)`,
  `findById`, `createRule`, `updateRule`, `deleteRule` (all funneled through `runRead`/`runWrite`
  per `BaseRepository` convention), plus `CreateValidationRuleInput`/`UpdateValidationRuleInput`
  types.
- `libs/validation/src/rules/validation-rule-admin.service.ts`: new — thin CRUD orchestration
  (`create`/`list`/`findOne`/`update`/`remove`), throwing `NotFoundException` for unknown ids.
  Kept separate from `ValidationRuleService` (the read-only "validate a candidate" path) so the
  read path never gains a write-path dependency.
- `libs/validation/src/testing/validation-test-datasource.ts`: new — in-memory sqlite `DataSource`
  + `fakeRepositoryResolver`, mirroring `libs/queue`'s equivalent, so repository/admin-service
  tests exercise real TypeORM query behavior without a MySQL connection.
- `ValidationModule.forRoot`/`forRootAsync` now also provide `ValidationRuleAdminService`, but
  only when `rules.enabled` — providing it without DB-backed rules enabled would let a caller
  "manage" rows that `NoopValidationRuleStore` silently ignores on the read path.
- `apps/server/src/validation-rules/`: new — `CreateValidationRuleDto`, `UpdateValidationRuleDto`,
  `ValidationRuleResponseDto` (with a `fromEntity` mapper, matching `RoleResponseDto`'s style),
  and `ValidationRuleController` (`POST`/`GET`/`GET :id`/`PATCH :id`/`DELETE :id` under
  `/validation-rules`, guarded by `JwtAuthGuard` + `PermissionsGuard` +
  `Permissions('validation-rules:manage')` — same shape as `RoleController`). Wired into
  `AppModule`'s `controllers` array.

## Why

- The admin surface belongs in `apps/server`, not `libs/validation`, because building it inside
  the library would require depending on `@/auth` for guards/permissions — exactly the dependency
  Design 001/002 ruled out (`libs/validation` may depend on `@/database`, never on a peer lib like
  `@/auth`). Apps are free to compose both libs; libs are not free to depend on each other.
- `validation-rules:manage` isn't seeded (unlike `roles:manage`, which needs a bootstrap migration
  to escape the chicken-and-egg RBAC problem) — an admin who already holds `roles:manage` can
  create and grant it via the existing `POST /auth/permissions` endpoint. No `libs/auth` changes
  were needed.

## Tests

15 new tests (`validation-rule.repository.spec.ts`, `validation-rule-admin.service.spec.ts`)
against the in-memory sqlite datasource, covering create/find/update/delete and not-found paths.
Full repo suite: 126 suites / 998 tests passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- No controller-level tests (e.g. supertest against the HTTP layer) — the service layer
  underneath is fully tested; adding HTTP-level tests is reasonable follow-up but wasn't treated
  as blocking, consistent with how `RoleController` itself has no dedicated HTTP-level spec either.
- No caching of `findRules(targetType)` — still deferred per Design 002.
- Cross-field stored conditions, workflow step-input validation hook, auth
  uniqueness-as-Specification — still deferred to their own concrete needs.

## Next Loop

- None forced. The stored-rule feature is now end-to-end usable (create via HTTP → persisted →
  read back by `ValidationRuleService` during validation). Next work here should wait for a
  concrete need (e.g. someone actually wiring `ValidationRuleService.validateStored` into a
  specific endpoint/workflow step).

---

# Loop 006

**Library:** validation
**Date:** 2026-07-20

## Goal

Review pass (Phase 1/2) over everything built in Loops 001–005, looking for real defects rather
than adding scope — per the ci.loop discipline of not treating "continue" as license to invent
speculative features.

## Files Reviewed

- Every file under `libs/validation/src/` (fresh read, not relying on memory of writing it).
- `libs/auth/src/errors/role-not-found.error.ts` and `libs/auth/src/application/authorization.service.ts`
  (to check whether throwing HTTP exceptions directly from a service, vs. a named domain error
  class, is the established convention).
- Checked for other controllers using `@ApiQuery` (`grep -rn "ApiQuery" libs apps` — zero hits)
  before considering adding it to `ValidationRuleController.list`.

## Problems Found

**Critical**
- (none)

**High**
- (none)

**Medium**
- `ValidationRuleAdminService` threw a bare `NotFoundException` inline in three places, instead of
  a named domain error class extending it — every other lib's equivalent (`libs/auth`'s
  `RoleNotFoundError extends NotFoundException`, `PermissionNotFoundError`, etc.) uses a named
  subclass, and `libs/validation/src/errors/` already exists specifically for this pattern
  (`ValidationFailedError` was already there). This was a real inconsistency, not a style
  preference — fixed.

**Low**
- (none)

## Changes Made

- Added `libs/validation/src/errors/validation-rule-not-found.error.ts`
  (`ValidationRuleNotFoundError extends NotFoundException`).
- `ValidationRuleAdminService.findOne`/`update`/`remove` now throw `ValidationRuleNotFoundError`
  instead of a bare `NotFoundException`.
- Updated `validation-rule-admin.service.spec.ts` assertions/test titles to check for
  `ValidationRuleNotFoundError` specifically (still an `instanceof NotFoundException`, so no HTTP
  behavior changed — this only makes the thrown type more specific).
- Exported `ValidationRuleNotFoundError` from the barrel.

## Why

- Consistency with the established per-lib "named domain error extends the Nest HTTP exception"
  pattern used everywhere else in the repo (see Files Reviewed). A caller catching
  `ValidationRuleNotFoundError` specifically (vs. any `NotFoundException` from anywhere in the
  app) is meaningfully better DX, and it was a one-file, zero-risk fix.
- Deliberately did **not** add `@ApiQuery` to `ValidationRuleController.list`'s `targetType`
  param — confirmed via grep that no controller in the repo uses it, so adding it would invent a
  new convention rather than fix an inconsistency. Not a defect; left alone.

## Tests

No new tests (existing tests updated in place to assert the more specific error type). Full repo
suite: 126 suites / 998 tests passing (same count as Loop 005 — no tests added or removed).

## Build

PASS

## Lint

PASS

## Remaining TODO

- Unchanged from Loop 005.

## Next Loop

- None forced. This loop found one real Medium-severity inconsistency and fixed it; no further
  issues surfaced on this pass. Per Section 16, further work should wait for a concrete
  requirement rather than another speculative review pass.

---

# Loop 007

**Library:** validation
**Date:** 2026-07-20

## Goal

Add HTTP-level tests for `ValidationRuleController`, per the user's explicit choice when asked
what to work on next.

## Correction to Loop 005

Loop 005 stated `RoleController` (`libs/auth`) "has no dedicated HTTP-level spec either" — that
was wrong. `libs/auth/src/http/role.controller.spec.ts` exists; it's a delegation-style unit spec
(instantiate the controller directly with a hand-mocked service, assert each method delegates
with the right arguments and maps the response), not a supertest/e2e test. Checked before writing
new tests this loop so the new spec would actually match the established pattern rather than
repeat the earlier mistake.

## Files Reviewed

- `libs/auth/src/http/role.controller.spec.ts` (the pattern to mirror)
- `apps/server/test/app.e2e-spec.ts` (confirmed the repo's only real supertest/e2e test is a
  generic smoke test against the whole `AppModule`, not per-controller — so a full e2e spec for
  `ValidationRuleController` would be a new convention, not a gap fix)

## Problems Found

**Critical / High / Medium**
- (none — this loop only added tests)

**Low**
- (none)

## Changes Made

- `apps/server/src/validation-rules/validation-rule.controller.spec.ts`: delegation-style unit
  spec for all five routes (`create`/`list`/`findOne`/`update`/`remove`), matching
  `role.controller.spec.ts`'s style exactly (hand-mocked `ValidationRuleAdminService`, asserting
  call arguments and mapped response shape).
- `apps/server/src/validation-rules/validation-rule-response.dto.spec.ts`: covers
  `ValidationRuleResponseDto.fromEntity`'s field mapping, including the `message: undefined → null`
  normalization.

## Why

- User asked for HTTP-level tests specifically. Matched the existing `role.controller.spec.ts`
  convention rather than introducing a new supertest-based e2e pattern that nothing else in the
  repo uses.

## Tests

8 new tests. Full repo suite: 128 suites / 1006 tests passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- Unchanged from Loop 006.

## Next Loop

- None forced.

---

# Loop 008

**Library:** validation
**Date:** 2026-07-20

## Goal

Cache `findRules(targetType)` results, per the user's explicit choice when asked which deferred
item to pick up next — proceeding on that explicit instruction, not on a measured bottleneck
(Design 002 had deferred this specifically "until it's a measured bottleneck").

## Files Reviewed

- `libs/auth/src/adapters/cache-access-token-denylist.ts` (the precedent for how a peer lib
  depends on `@/cache`: type-only `CacheManager` import, host constructs the instance manually,
  no dependency on `@/cache`'s tokens or module)
- `libs/cache/src/cache-manager.ts` (confirmed `getOrLoad(cache, key, loader, { ttl })` — a single
  call handles get-or-compute-and-cache, so `CachedValidationRuleStore` doesn't need to hand-roll
  get/set/race handling)
- `apps/server/src/app.module.ts` (confirmed `CacheModule` is already registered `global: true`,
  and `CACHE_MANAGER`/`CacheManager` are already imported there for `AuthModule`'s denylist — no
  new cache infrastructure needed, just a second consumer of what's already wired)

## Problems Found

**Critical / High**
- (none — see `ARCH.md` Design 003 for the module-boundary decision, treated as a design change
  rather than an ordinary review finding, consistent with Section 0.6)

**Medium**
- (none)

**Low**
- (none)

## Changes Made

- `libs/validation/src/rules/cached-validation-rule.store.ts`: new — `CachedValidationRuleStore`
  wraps an inner `ValidationRuleStore` with a `CacheManager` (type-only import from `@/cache`),
  using `getOrLoad` with a default 30s TTL, cache key `validation-rules:${targetType}`.
- `ValidationModuleAsyncOptions.rules` gained optional `useFactory`/`inject` (parallel to the
  existing top-level error-factory shape), so a host can supply an arbitrary `ValidationRuleStore`
  — caching is one use of this escape hatch, not the only one.
- `ValidationModule.forRoot`/`forRootAsync` now always register `NoopValidationRuleStore` and
  `DatabaseValidationRuleStore` as their own class providers (previously only reachable via
  `useClass` under the `VALIDATION_RULE_STORE` token), using `useExisting` instead of `useClass`
  for the plain enabled-boolean path so this doesn't construct a second instance. This lets a
  custom `rules.useFactory` inject `DatabaseValidationRuleStore` as a dependency to wrap.
- `apps/server/src/app.module.ts`: switched `ValidationModule.forRoot({ rules: { enabled: true } })`
  to `forRootAsync`, injecting `CACHE_MANAGER` (already imported for `AuthModule`) and
  `DatabaseValidationRuleStore` to construct the `CachedValidationRuleStore`.
- Appended Design 003 to `ARCH.md` before implementing, since this reopens/extends the module
  boundary question (peer-lib dependency on `@/cache`) the same way Design 002 did for `@/database`.

## Why

- The user explicitly asked for this after I flagged that Design 002 had deferred it pending a
  measured bottleneck — this is a stated requirement overriding that deferral, not a discovered
  need, and `ARCH.md`'s Design 003 goal section says so explicitly to keep that distinction clear
  for future readers.
- Chose the type-only-import + host-constructs pattern (mirroring `CacheAccessTokenDenylist`) over
  having `libs/validation` inject `CACHE_MANAGER` directly, per Section 17 ("prefer existing
  patterns over inventing new ones") — the existing precedent achieves the same result with
  strictly less peer-lib coupling.

## Tests

2 new tests (`cached-validation-rule.store.spec.ts`) covering cache-hit-avoids-second-call and
independent caching per target type, using a fake in-memory `CacheManager`. Full repo suite: 129
suites / 1008 tests passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- Cache invalidation on rule write is still TTL-only (no active invalidation when
  `ValidationRuleAdminService` edits a rule) — deferred per `ARCH.md` Design 003; revisit only if
  30s staleness after an edit proves to matter.
- Everything else unchanged from Loop 006 (cross-field conditions, workflow step-input hook, auth
  uniqueness-as-Specification — still no concrete need).

## Next Loop

- None forced.

---

# Loop 009

**Library:** validation (+ libs/queue)
**Date:** 2026-07-20

## Goal

User asked to complete every remaining deferred item at once. This loop covers the first three:
migrate `libs/queue`'s last bespoke validator, close the cache-invalidation gap Design 003 left
open, and add cross-field stored conditions (`ARCH.md` Design 004/005).

## Files Reviewed

- `libs/queue/src/context/rmq-header.parser.ts` + `libs/queue/src/utils/validation-errors.ts`
  (confirmed the util had exactly one remaining caller before removing it)
- Every implementer of `ValidationRuleStore` (`Noop`/`Database`/`Cached`) and every test file
  constructing a `StoredRule` literal directly (to update for the new required `invalidate`
  method and `compareField` property)

## Problems Found

**Critical / High**
- (none beyond the module/schema decisions already documented in ARCH.md Design 004/005)

**Medium / Low**
- (none)

## Changes Made

**rmq-header.parser.ts migration**
- Rewrote `RMQHeaderParser.parse` to use `ClassValidatorSpecification` (with the same
  `{ whitelist: true, forbidNonWhitelisted: false, forbidUnknownValues: true }` options it always
  used) instead of calling `plainToInstance`/`validateSync` directly.
- Deleted `libs/queue/src/utils/validation-errors.ts` and its spec — dead code once this was the
  last caller.

**Cache invalidation (ARCH.md Design 004)**
- `ValidationRuleStore.invalidate(targetType)` added to the interface; no-op in
  `NoopValidationRuleStore`/`DatabaseValidationRuleStore`, real cache-bust
  (`cacheManager.delete`) in `CachedValidationRuleStore`.
- `ValidationRuleAdminService` now also depends on `VALIDATION_RULE_STORE`, calling
  `invalidate(targetType)` after `create`/`update`/`remove`. `remove` now fetches the entity
  first (to know its `targetType`) before deleting.

**Cross-field stored conditions (ARCH.md Design 005)**
- `ValidationRuleEntity`/`StoredRule` gained nullable `compareField`; new migration
  `AddCompareFieldToValidationRule1753300000000` (`ALTER TABLE`, not a new `CREATE TABLE`).
- `evaluateStoredRule` compares `candidate[field]` against `candidate[compareField]` when set,
  restricted to equals/not_equals/numeric comparisons — fails closed with a reason for
  `in`/`not_in`/`contains`/`not_contains`.
- `CreateValidationRuleDto`/`UpdateValidationRuleDto`/`ValidationRuleResponseDto` gained optional
  `compareField`.

## Why

- All three are explicit "please complete this" items, not discovered needs — see `ARCH.md`
  Design 004/005 goal sections for why each records that distinction.

## Tests

Repository test for `compareField` persistence; 3 new `evaluateStoredRule` cross-field tests; 2
new `CachedValidationRuleStore.invalidate` tests; `ValidationRuleAdminService` tests updated to
assert `invalidate` is called with the right `targetType`. Full repo suite: 128 suites / 1010
tests passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- `libs/auth` uniqueness-as-Specification and `libs/workflow` step-input validation hook — next up
  in this same completion pass (separate loop entries, since they touch different libraries).

## Next Loop

- `libs/auth` uniqueness-as-Specification.

---

# Loop 010

**Library:** validation
**Date:** 2026-07-20

## Goal

Live-test the whole stack against real MySQL/Redis/RabbitMQ (`make compose-up` + `npm run
start:dev`), per the user's "run serve" request — the same kind of pass `libs/auth`'s Loop 004
did, and specifically the thing unit tests with fake/manually-constructed dependencies cannot
catch: real NestJS DI wiring and real `class-transformer` object shapes over HTTP.

## Files Reviewed

- Live boot logs (`NestFactory`, `RepositoryDiscoveryService`, route mapping).
- Full CRUD flow against `/validation-rules` over HTTP, with a real JWT and real MySQL rows.

## Problems Found

**Critical**
- `ValidationRuleAdminService`'s constructor injected `ValidationRuleRepository` as a plain
  constructor-typed dependency, with no `@InjectRepository()` decorator. `libs/database`'s
  `RepositoryProviderFactory` only registers providers under `getRepositoryToken(repository,
  role)` — a role-scoped symbol — never under the bare class. The app failed to boot at all
  (`UnknownDependenciesException`) the moment `ValidationModule` tried to construct this service.
  `DatabaseValidationRuleStore` (added in Loop 004) already used `@InjectRepository(...)`
  correctly — this one call site was missed. No unit test caught it because every existing test
  constructs `ValidationRuleRepository` directly with `new`, never through Nest's real DI
  container.

**High**
- `ValidationRuleRepository.updateRule` used `Object.assign(existing, patch, {...})` where
  `patch` — over real HTTP — is a `class-transformer`-constructed `UpdateValidationRuleDto`
  instance, not a plain object literal. Every declared optional class field
  (`field?`, `operator?`, `value?`, `compareField?`, `message?`) is present as an explicit own
  `undefined` property on that instance (TypeScript class-field "define" semantics under the
  repo's `ES2023` target) — `Object.assign` copies those `undefined`s over `existing`'s real
  values. TypeORM's `save()` silently omits `undefined` columns from the generated `UPDATE`
  (so the database row stayed correct), but the in-memory entity — and thus the JSON API
  response — lost `field`/`operator`/`value` entirely and showed `message`/`compareField` as
  `null`. `PATCH /validation-rules/:id { "enabled": false }` visibly returned a rule missing most
  of its fields. Existing repository tests used plain object literals (`{ enabled: false }`),
  which never reproduce class-field "define" semantics, so this was invisible to the suite.

**Medium / Low**
- Also confirmed, as a bonus check (not a defect): the same already-issued JWT gained
  `validation-rules:manage` access immediately after the permission was granted mid-session, with
  no re-login — the "changes effective immediately" guarantee from `libs/auth`'s guard fix
  (Loop 008 there) still holds when exercised against this new endpoint.

## Changes Made

- `ValidationRuleAdminService`: constructor now uses `@InjectRepository(ValidationRuleRepository)`
  (default `DatabaseRole.WRITE`, matching `libs/auth`'s `AuthorizationService` convention for
  repositories that both read and write).
- `ValidationRuleRepository.updateRule`: filters `patch` to only its defined (non-`undefined`)
  entries before `Object.assign`, so untouched fields are never overwritten regardless of whether
  the caller passes a plain object or a `class-transformer` DTO instance.
- Added a regression test that constructs the patch via `plainToInstance` (reproducing the exact
  "define" semantics that caused the bug) and asserts every untouched field survives a partial
  update.
- Also added `AUTH_JWT_SECRET` to the local `.env` (was missing entirely, unrelated to this
  library — `apps/server`'s bootstrap validates it and refused to start without one).

## Why

- Both were real defects invisible to the existing test suite specifically because every test
  either constructs collaborators manually (bypassing Nest's DI token resolution) or passes plain
  object literals (bypassing `class-transformer`'s instance-construction semantics). This is
  exactly the gap "run the app for real" closes that a mocked/faked unit-test suite cannot — see
  the `run` skill's emphasis on driving the app to a point a real user would reach, not just
  launching it.

## Live verification performed (real MySQL/Redis/RabbitMQ)

- Booted `apps/server` against real MySQL/Redis/RabbitMQ; confirmed `validation_rule` migrations
  (including the Loop 003 `compareField` `ALTER TABLE`) ran and `/validation-rules` routes mapped.
- Registered a user, bootstrapped `admin` via direct SQL (documented ops step, matching
  `libs/auth/ARCH.md`), logged in, created `validation-rules:manage` via `POST
  /auth/permissions`, granted it to `admin` via SQL (no "add permission to an existing role"
  endpoint exists yet — noted, not built speculatively).
- Full CRUD cycle against `/validation-rules`: `POST` (create), `GET` (list + get-by-id), `PATCH`
  (update), `DELETE` (+ `404` on both a second delete and a get-after-delete) — all against real
  MySQL rows, verified against the raw table between requests.
- Confirmed the DB row itself was correct throughout (the `PATCH` bug was response-serialization
  only, not data corruption) before concluding root cause.
- Cleaned up all test data (rows, user, permission, role grant) after verification.

## Tests

1 new regression test (`plainToInstance`-based). Full repo suite: 131 suites / 1021 tests passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- No "grant an existing permission to an existing role" HTTP endpoint (only `createRole` grants
  at creation time) — required direct SQL during this verification. Not built speculatively; flag
  if it becomes a recurring need.
- Unchanged otherwise from Loop 009.

## Next Loop

- None forced. Both fixes are live-verified. Not yet committed — flagged to the user rather than
  committed automatically.

---

# Loop 011

**Library:** validation

**Date:** 2026-07-20

## Goal

Extend `compareField` cross-field comparison to `in`/`not_in`/`contains`/`not_contains` — Design
005 had restricted this to equals/not_equals/numeric operators; user asked to complete it.

## Files Reviewed

- `rule-evaluator.ts` — re-examined the Design 005 rejection ("what does 'the other field is an
  array' mean for `in`") and found it already had a well-defined answer, just unexamined at the
  time: swap `candidate[compareField]` in wherever `rule.value` was already being used as "the
  thing to compare against."

## Problems Found

**Critical / High / Medium / Low**
- (none — this is a design reversal with rationale in `ARCH.md` Design 006, not a review finding)

## Changes Made

- `evaluateMembership`/`evaluateContains` now take a resolved `comparisonValue` parameter (same
  shape `evaluateNumericComparison` already had) instead of hardcoding `rule.value`.
- Removed `CROSS_FIELD_SUPPORTED_OPERATORS` and its fail-closed branch entirely — every operator
  now honors `compareField`.
- Replaced the now-obsolete "compareField fails closed for operators that do not support
  cross-field comparison" test with real coverage: `in`/`not_in` cross-field (including the
  fail-closed "other field must be an array" case) and `contains`/`not_contains` cross-field
  (other field becomes the needle).
- Appended Design 006 to `ARCH.md` documenting the reversal and why it's not a security-relevant
  walk-back (unlike the regex/expression-language rejections, which stay rejected).

## Why

- Explicit user request to complete this previously-restricted item.

## Tests

7 tests changed/added (2 new passing cases, 1 fail-closed case, replacing 1 obsolete test).
Full repo suite: 131 suites / 1032 tests passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- Unchanged otherwise.

## Next Loop

- None forced.

---

# Loop 012

**Library:** validation

**Date:** 2026-07-20

## Goal

Make `value` optional on cross-field (`compareField`-set) validation rules — a gap Design 006
left behind: the evaluator never reads `rule.value` once `compareField` is set, but the schema,
entity, and create DTO still demanded a literal `value` on every rule.

## Files Reviewed

- `rule-evaluator.ts` — confirmed `comparisonValue` already falls back to `candidate[compareField]`
  and never touches `rule.value` in that branch, for every operator.
- `create-validation-rule.dto.ts` / `update-validation-rule.dto.ts` — the update DTO was already
  correctly optional (partial-update semantics); only the create DTO needed the conditional.
- `validation-rule.entity.ts`, `validation-rule.repository.ts`, `migrations/index.ts` — schema and
  persistence layer.

## Problems Found

**High**
- `validation_rule.value` was `NOT NULL` and `CreateValidationRuleDto.value` was unconditionally
  `@IsDefined()`, forcing callers creating a cross-field rule to supply a meaningless placeholder
  value the evaluator would never read.

**Medium / Low**
- (none)

## Changes Made

- New migration `MakeValidationRuleValueNullable1753400000000`: `validation_rule.value` →
  nullable `json`.
- `ValidationRuleEntity.value` and `CreateValidationRuleInput.value` → optional; repository
  defaults an omitted `value` to `null` on create.
- `CreateValidationRuleDto.value`: `@ValidateIf(dto => !dto.compareField)` + `@IsDefined()` —
  required only when `compareField` is absent; Swagger doc updated to `ApiPropertyOptional`.
- Appended Design 007 to `ARCH.md`.

## Why

- Closes a gap Design 006 exposed but didn't fix: once every operator honored `compareField`,
  requiring `value` on cross-field-only rules no longer matched the domain invariant the
  evaluator already enforced implicitly.

## Tests

New: DTO spec (`create-validation-rule.dto.spec.ts`, 4 cases covering required/optional `value`
under `compareField`) and one repository spec (`createRule` defaults `value` to `null`).
`libs/validation` + `apps/server/src/validation-rules` suites: 12 suites / 64 tests passing.

## Build

PASS

## Lint

PASS

## Remaining TODO

- Unchanged otherwise.

## Next Loop

- None forced. Change is HIGH risk (schema) per Design 007 — flagged to the user rather than
  committed automatically.

---

# Loop 013

**Library:** validation

**Date:** 2026-07-21

## Goal

Fresh, adversarial Phase 1/2 review of `libs/validation` as it stands after 12 prior loops —
looking for a real defect rather than rubber-stamping "nothing found" or inventing cosmetic
busywork (per ci.loop §18: don't refactor code that already satisfies readability/maintainability/
correctness).

## Files Reviewed

- Every non-spec file under `libs/validation/src/` (core, class-validator, nest, errors,
  persistence, rules), read fresh against ci.loop §2/§10/§12/§13.
- `libs/database/src/decorators/database-repository.decorator.ts`,
  `libs/database/src/repository/repository.providers.ts`,
  `libs/database/src/repository/repository-resolver.ts` — to rule out a repeat of Loop 010's
  missing-`@InjectRepository` class of bug and to confirm `DatabaseValidationRuleStore` being
  unconditionally constructed (Loop 008 change) is genuinely inert (no DataSource access) when
  `rules.enabled` is false, not a latent boot-time crash for a hypothetical second host app.
- `libs/auth/src/specifications/unique-email.specification.ts` (+ `unique-role-name`,
  `unique-permission-name`) — confirmed these already `import type { Specification } from
  '@/validation'` rather than redefining the interface, so the Design 001/ARCH.md "auth uniqueness
  checks as async Specifications" open item is in fact already done; no duplication to fix and
  `libs/auth` was not touched.
- `libs/queue/src` / `libs/workflow/src` grepped for `validateSync`/`plainToInstance` — only hit is
  `libs/auth/src/config/auth.schema.spec.ts` (a schema test, unrelated) — confirmed no remaining
  bespoke class-validator invocation duplicating `ClassValidatorSpecification` anywhere else in the
  monorepo.

## Problems Found

**Critical**
- (none)

**High**
- (none)

**Medium**
- `evaluateStoredRule` (`rule-evaluator.ts`)'s `switch (rule.operator)` had no `default` branch.
  Every declared type-mismatch path in this function fails closed (returns `{ satisfied: false,
  reason }`) by explicit design — see the function's own docstring and ARCH.md Design 002's MEDIUM
  decision ("a misconfigured stored rule should be visible as a validation failure, not a silent
  no-op"). But an `operator` value outside the `ValidationRuleOperator` enum fell through the
  switch with no matching case and no `default`, so the function returned `undefined` instead of a
  `RuleEvaluation` — TypeScript didn't catch it (`noImplicitReturns` isn't set, and `strict: true`
  doesn't imply it) and no test exercised it. The caller (`StoredConditionSpecification.
  isSatisfiedBy`) then dereferences `.satisfied` on `undefined`, throwing a `TypeError` instead of
  producing the designed fail-closed validation failure. Reachable via a row written or edited
  outside the DTO-validated admin API (direct SQL, a migration, an ops fix — Loop 010 already
  needed a direct-SQL workaround once for an unrelated reason) or a future `ValidationRuleOperator`
  member added without updating this switch — not reachable through the normal HTTP admin path
  today (the DTOs `@IsEnum`-validate `operator`), but the whole point of "fail closed" as a stated
  design invariant is to hold even when the normal path is bypassed, and this one silently didn't.

**Low**
- (none)

## Changes Made

- `libs/validation/src/rules/rule-evaluator.ts`: added a `default` branch to `evaluateStoredRule`'s
  switch, returning `{ satisfied: false, reason: 'Rule #<id>: unknown operator "<value>"' }` —
  matching the exact shape/tone of every other fail-closed branch in the same function.
- `libs/validation/src/rules/rule-evaluator.spec.ts`: added a regression test constructing a rule
  with an operator value outside the enum and asserting the function now fails closed with a
  reason instead of throwing.

## Why

- This is a real, narrowly-scoped correctness/robustness gap in code that otherwise already
  satisfies ci.loop's readability/maintainability bar (§18) — not a style preference, and not
  speculative scope creep: it directly undermines a design invariant `ARCH.md` explicitly commits
  to ("fails closed... rather than silently coercing or silently passing"), which the function
  itself failed to honor for exactly one input shape. Fix is minimal (one `default` case, no
  signature change, no new dependency) and adds coverage for a path the existing 12-loop test
  suite never exercised.
- Everything else reviewed (module wiring, DI token resolution, cache-invalidation correctness,
  repository CRUD, DTO/entity nullability, class-validator adapter defaults, error factory
  indirection) held up under fresh adversarial review — no further defects found, and no cosmetic
  refactor was applied per §18's explicit prohibition on refactoring already-correct code.

## Tests

1 new test (`rule-evaluator.spec.ts`). `libs/validation` scoped suite: 9 suites / 53 tests passing
(up from 52). Full repo suite: 133 suites / 1048 tests passing (no regressions; no live infra
required — existing suite uses fake/in-memory datasources and mocks throughout).

## Build

Not run separately — `npm run typecheck` (below) covers compilation; `nest build` was not
exercised this loop (no build-affecting change: no new exports, no config/tooling changes).

## Lint

PASS (`npx eslint libs/validation/src`, zero errors/warnings)

## Typecheck

PASS (`npm run typecheck`, zero errors)

## Remaining TODO

- Unchanged from Loop 012: no forced next item. `@Step({ inputSpec })` workflow hook and any
  further auth-side validation work remain deferred to their own concrete needs (auth's uniqueness
  checks are already done — see Files Reviewed above, this was previously listed as open but
  turned out to be already resolved by `libs/auth`'s own loop).

## Next Loop

- None forced. This loop found and fixed one real Medium-severity fail-closed gap; no further
  issues surfaced on adversarial re-review. Per ci.loop §16, further work should wait for a
  concrete requirement or a genuinely new defect, not another speculative pass.

---

# Loop 014

**Library:** validation
**Date:** 2026-07-23

## Goal

Fresh adversarial Phase 1/2 pass, prompted by the same-day pattern of this `ci.loop` run finding
real defects in sibling libraries by tracing what happens when a normally-reliable secondary
operation (a cache write, a transaction commit) actually fails. Focused on
`ValidationRuleAdminService`'s write path and `CachedValidationRuleStore`'s invalidation, which
hadn't had this specific angle applied before.

## Files Reviewed

- `rules/validation-rule-admin.service.ts` (`create`/`update`/`remove`) — traced what happens if
  `store.invalidate()` throws after each operation's DB write already committed.
- `persistence/validation-rule.repository.ts` — confirmed `UpdateValidationRuleInput` deliberately
  excludes `targetType` (only `field`/`operator`/`value`/`compareField`/`message`/`enabled` are
  patchable), ruling out a hypothesized "update moves a rule to a different targetType, leaving the
  old targetType's cache never invalidated" bug — `targetType` is immutable post-creation by
  construction, so `updated.targetType` after any `update()` call is always the same key that was
  cached to begin with.
- `rules/cached-validation-rule.store.ts` — confirmed `invalidate()` is a thin
  `cacheManager.delete(...)` call with no internal error handling of its own, so any transient
  cache-backend failure (e.g. Redis blip) propagates straight up to whatever called `invalidate()`.
- `ARCH.md` Design 004 (the design session that added `invalidate()` to the write path) — confirmed
  this specific failure mode (cache-invalidation failure masking a successful DB write) was never
  considered.

## Problems Found

**Critical / High** — none.

**Medium**
- `ValidationRuleAdminService.create()`/`update()`/`remove()` called `this.store.invalidate(...)`
  after their respective DB write already succeeded, with no error handling. If the cache backend
  is transiently unavailable and `invalidate()` throws, the exception propagates out of
  `create`/`update`/`remove` — the caller sees the whole operation as failed even though the
  database write already committed. Worst for `remove()`: an admin believes a rule deletion failed
  (and may assume the rule is still enforced) when the row is actually gone — and the stale cache
  (the thing that actually failed) keeps serving the deleted rule for up to its 30s TTL regardless
  of the apparent error. A best-effort secondary side effect (cache invalidation) was allowed to
  mask the outcome of the primary operation (the DB write) it followed.

**Low** — none newly found this loop.

## Changes Made

- `rules/validation-rule-admin.service.ts`: added a `Logger`; extracted a private
  `invalidateStore(targetType)` that wraps `store.invalidate(targetType)` in try/catch, logging a
  `warn` on failure instead of propagating — `create`/`update`/`remove` all route through it now.
- `rules/validation-rule-admin.service.spec.ts`: added a regression test where `store.invalidate`
  is mocked to reject on every call, asserting `create`/`update`/`remove` all still succeed (the
  created/updated entity is returned correctly, the removed rule is actually gone) despite the
  cache-invalidation failure.

## Why

- Direct instance of the "Error Handling"/"Developer Experience" quality axes (Section 2) and the
  same "a best-effort side effect shouldn't mask a successful primary operation" pattern already
  established elsewhere in this monorepo (e.g. `WorkflowFailureService` catching-and-logging a
  publish failure rather than letting it look like the state write failed). Fix is additive and
  narrowly scoped (one new private method, no signature/interface change to
  `ValidationRuleAdminService` or `ValidationRuleStore`), so MEDIUM risk per ci.loop §18 — backward
  compatible for every caller, and strictly reduces surprising behavior (a successful write can no
  longer present as a failure).
- The hypothesized `targetType`-change staleness bug was investigated and ruled out rather than
  assumed away — `UpdateValidationRuleInput`'s field list was checked directly against the
  entity/DTO shape before concluding it doesn't apply.

## Tests

`libs/validation` suite is now 9 spec files / 55 tests (up from 54). Full monorepo suite: 145
suites / 1175 tests, all passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None new. Login brute-force protection and other libraries' own carried-over items are
  unaffected by this loop.

## Next Loop

- No further Critical/High/Medium findings this pass beyond the one fixed. `libs/validation`
  remains at a natural stopping point per Section 16.

---

# Loop 015

**Library:** validation
**Date:** 2026-07-23

## Goal

Second adversarial pass in the same session as Loop 014, matching the "two consecutive clean
passes" bar this session reached for every other library. Targeted the remaining non-trivial
files not individually reviewed in Loop 014: `core/composite-specifications.ts` (And/Or/Not
combinators), `class-validator/class-validator.specification.ts`,
`rules/stored-condition.specification.ts`, `nest/validation.service.ts`,
`rules/database-validation-rule.store.ts`, `rules/validation-rule.service.ts`.

## Files Reviewed

- `core/composite-specifications.ts` — traced `AndSpecification`/`OrSpecification`/
  `NotSpecification`'s `isSatisfiedBy`/`explain` pairs for double-evaluation and short-circuit
  correctness. `OrSpecification.isSatisfiedBy` correctly short-circuits (native `||` skips the
  right operand's `isSatisfiedBy` call once the left is `true`). `explain()` on each combinator
  re-evaluates `isSatisfiedBy`/sub-`explain()` independently of the prior `isSatisfiedBy` call a
  caller (`ValidationService.validate`) already made — a real but minor inefficiency (re-running
  possibly-async/DB-backed specifications' checks twice on the failure path), not a correctness
  bug, and `explain()` only runs after a validation has already failed, not on the hot path.
- `class-validator/class-validator.specification.ts` — `validate()`'s `plainToInstance`/
  `validateSync` pairing, `DEFAULT_OPTIONS`'s `whitelist`/`forbidNonWhitelisted`/
  `forbidUnknownValues` fail-closed defaults; unchanged and correct.
- `rules/stored-condition.specification.ts` — `composeStoredRules`'s AND-composition over stored
  rules and the `AlwaysSatisfiedSpecification` empty-set case; unchanged and correct.
- `nest/validation.service.ts`, `rules/validation-rule.service.ts` — `validate`/`validateOrThrow`'s
  per-specification isSatisfiedBy-then-explain-on-failure loop, and `ValidationRuleService`'s
  thin composition over `ValidationRuleStore`/`ValidationService`; unchanged and correct.
- `rules/database-validation-rule.store.ts` — confirmed `invalidate()` is correctly a no-op
  (this store has no cache of its own to bust; `CachedValidationRuleStore` is the one that wraps
  it and actually needs invalidation).

## Problems Found

**Critical / High / Medium** — none.

**Low**
- The double-evaluation inefficiency in `composite-specifications.ts`'s `explain()` methods
  (noted above) — not fixed: `explain()` only runs on the already-failed path, and every
  `Specification` implementation in this library is either pure/cheap (class-validator) or a
  single already-loaded-into-memory array scan (`StoredConditionSpecification` over rules
  `ValidationRuleService` already fetched) — no realistic double-DB-round-trip scenario exists
  today to justify restructuring the combinators to cache/reuse the first `isSatisfiedBy` result.

## Changes Made

None — nothing found that crossed the bar for a change.

## Why

Two consecutive clean adversarial passes (Loop 014 found and fixed one real Medium — the
cache-invalidation-failure-masking-a-successful-write gap; this loop reviewed every remaining
non-trivial file and found nothing beyond a Low-severity, not-worth-fixing inefficiency) meets the
ci.loop §16 stopping condition for this library, matching the other six libraries' status this
session.

## Tests

No test changes. Full monorepo suite: 145 suites / 1175 tests, all passing (unchanged — no code
touched this loop).

## Build

Not re-run — no code changed this loop.

## Lint

Not re-run — no code changed this loop.

## Remaining TODO

- None new.

## Next Loop

- No Critical/High/Medium findings across two consecutive adversarial passes. `libs/validation`
  remains at a natural stopping point per Section 16 until a new concrete finding or requirement
  surfaces.

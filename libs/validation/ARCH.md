# Design 001

**Library / Bounded Context:** libs/validation
**Date:** 2026-07-20

## Goal

Provide one cross-cutting validation capability — shape validation, business-rule/domain-invariant
validation, and async/state-dependent validation — that `apps/server`, `libs/queue`,
`libs/workflow`, and `libs/auth` can all consume, replacing per-library bespoke validation code
(e.g. `libs/queue`'s `RMQPayloadValidator` + `formatValidationErrors`) with one shared primitive.

## Scale/Team Context Assumed

Single team, single monorepo, low-to-moderate throughput (per user: "Small — single app/team, low
complexity"). This assumption caps the design: no rule-authoring DSL, no rule registry/versioning,
no distributed rule evaluation — a plain TypeScript `Specification<T>` pattern is sufficient and
consistent with how every other `libs/*` package expresses cross-cutting behavior (a small
interface + DI token with a no-op default), not a bespoke rule engine.

## Bounded Contexts Identified

- **Validation** is a Supporting/Generic Domain (never a Core Domain) — same category as
  `libs/cache`: a capability every other context uses, but not a place where business meaning
  lives. It owns no aggregates, no persisted state, no domain events.
- It does not own error *presentation* (HTTP status codes, AMQP retry semantics, workflow failure
  transitions) — those stay owned by the consuming context. Validation only owns: "does this
  candidate satisfy this specification," and a swappable seam for the consumer to translate a
  failure into its own error type.

## Key Decisions (with risk tag)

**HIGH**
- Core abstraction is `Specification<T>` (`isSatisfiedBy(candidate): boolean | Promise<boolean>`,
  `explain(candidate): string[]`) with `and`/`or`/`not` combinators, rather than separate
  subsystems for "DTO validation" vs "business rules" vs "async validation." One primitive covers
  all three: a class-validator-backed `ClassValidatorSpecification<T>` is a sync Specification;
  a uniqueness-check-against-a-repository is an async Specification. This keeps the surface small
  and matches the "small team" constraint from 0.2, while still satisfying all four capabilities
  the user asked for.
  - *Alternative rejected:* a configurable rule engine (declarative rule definitions, a rule
    registry, versioned rule sets). Rejected — no other `libs/*` package uses a config-driven
    rule/DSL approach, throughput/team-count don't justify the added indirection, and it would
    violate Section 0.1 ("not every system needs every pattern").

**MEDIUM**
- Failure translation uses a DI token, `VALIDATION_ERROR_FACTORY`, with a no-op default
  (`DefaultValidationErrorFactory`, throws `ValidationFailedError`) — following the same
  "cross-cutting behavior injected via token, never hardcoded" convention already used by
  `libs/workflow` (`WORKFLOW_METRICS`, `WORKFLOW_EVENT_PUBLISHER`) and `libs/cache` (cache
  plugins). This is what lets `libs/queue` keep throwing `NonRetryableMessageError` and a future
  workflow integration throw a workflow-specific error, without the validation lib knowing about
  either.
- `ValidationService.validate(candidate, specs[])` returns a `ValidationResult` (collected
  `ValidationFailure[]`) rather than throwing directly; a `validateOrThrow` convenience method
  calls the injected error factory. Keeping the non-throwing form as the primitive (not the
  convenience wrapper) means callers that want to aggregate failures across multiple specs (e.g. a
  form with several independent business rules) aren't forced into try/catch-per-rule.

**LOW**
- Folder layout mirrors `libs/cache`/`libs/queue`: `core/` (interfaces + combinators),
  `class-validator/` (the shape-validation adapter + shared error formatter), `errors/`,
  `nest/` (module + injectable service), single `index.ts` barrel.

## Rejected Alternatives

- Rule engine / DSL with a registry and versioning — rejected, see HIGH decision above.
- Making `libs/validation` own error *presentation* (e.g. a global HTTP exception filter or a
  queue retry-classification helper) — rejected. That would blur the Supporting-Domain boundary:
  HTTP status mapping belongs to `apps/server`, retry classification belongs to `libs/queue`
  (`RetryableMessageError` vs `NonRetryableMessageError` already encode that policy). Validation
  only decides *pass/fail + why*, never *what happens next*.
- Async-only validation (dropping the sync class-validator path and forcing everything through
  `Promise`) — rejected; it would force `await` overhead onto request-body-shape checks that are
  synchronous today via Nest's own `ValidationPipe`, for no benefit.

## CQRS Decision

Not applicable / rejected. Validation is stateless per-call logic, not a data-ownership or
read/write-model split concern.

## Event Sourcing Decision

Not applicable / rejected. No persisted state, so no event history to source from.

## Open Questions / Future Evolution

- Whether `libs/queue`'s `RMQPayloadValidator` should be migrated to use
  `ClassValidatorSpecification` + `ValidationService` internally (its public
  `RMQPayloadValidator.validate()` static API would stay unchanged; only the implementation
  changes) — left as a follow-up Improvement Loop item, not bundled into this scaffold, to keep
  this change reviewable and low-risk.
- Whether `libs/workflow` steps should gain a declarative input-Specification hook (e.g. via
  `@Step({ inputSpec: ... })`) — additive, no existing behavior to break, but deferred until a
  concrete step needs it (avoid speculative API surface on a semver-sensitive package).
  See `WorkflowValidationError` as the natural extension point once a consumer needs it.
- Whether `libs/auth` should express "role/permission name uniqueness" as an async Specification
  instead of ad hoc repository checks — left for the auth library's own loop, since it's an
  internal implementation choice, not a validation-lib design decision.
- If a second team ever needs independently versioned validation contracts, revisit the "no
  registry/versioning" decision above (it was scoped to "single team," not asserted as permanent).

## Handoff to Improvement Loop

- **Public API surface:** `Specification<T>`, `and`/`or`/`not` combinators,
  `ClassValidatorSpecification`, `ValidationService` (`validate`/`validateOrThrow`),
  `ValidationModule.forRoot`/`forRootAsync`, `VALIDATION_ERROR_FACTORY` token +
  `ValidationErrorFactory` interface, `ValidationFailedError`, `formatValidationErrors`,
  all exported from `libs/validation/src/index.ts`.
- **Module boundaries:** `libs/validation` depends only on `class-validator`/`class-transformer`
  and `@nestjs/common`. It must never import from `@/queue`, `@/workflow`, `@/auth`, or
  `@/database` — it is upstream of all of them, never downstream.

  > **Superseded in part by Design 002** — see below: `libs/validation` now depends on
  > `@/database` too, for the same reason `libs/queue`/`libs/workflow` do (owning its own
  > entities/migrations that the host merges into one `DatabaseModule.forRoot()` call). The
  > "never downstream of a peer lib" half of this rule still holds — `@/queue`, `@/workflow`,
  > `@/auth` remain off-limits.

---

# Design 002

**Library / Bounded Context:** libs/validation
**Date:** 2026-07-20

## Goal

Support admin-configurable business rules: validation conditions stored as data (in MySQL, via
`libs/database`) instead of hardcoded `Specification` subclasses, so a non-engineer can add/edit
a rule (e.g. "role name must not be in this blocklist") without a code deploy.

## Scale/Team Context Assumed

Unchanged from Design 001 (single team, low-to-moderate throughput) — this is why the design below
is a narrow field/operator/value grammar, not a general rule-authoring DSL. "Admin-configurable"
does not mean "Turing-complete."

## Bounded Contexts Identified

- No new bounded context. Stored rules are still owned by the Validation Supporting Domain — they
  never gain business meaning of their own beyond "does this candidate satisfy this condition,"
  same as a hand-written `Specification`.

## Key Decisions (with risk tag)

**HIGH**
- `libs/validation` now depends on `@/database` (`BaseRepository`, `@DatabaseRepository`,
  `@InjectRepository`, `DatabaseRole`) — the same pattern `libs/queue` (`OutboxRepository`) and
  `libs/auth` (`RoleRepository`, etc.) already use: the lib owns its entity/migration/repository,
  exports `VALIDATION_TYPEORM_ENTITIES`/`VALIDATION_MIGRATIONS` for the host to merge into its own
  `DatabaseModule.forRoot()` call, and never manages a `DataSource` itself. This supersedes Design
  001's "must never import `@/database`" line — that line was correct for a stateless engine, and
  is no longer correct now that storing rules is a real requirement. The "never import a peer lib
  (`@/queue`/`@/workflow`/`@/auth`)" half of that rule is untouched.
  - *Alternative rejected:* keep `libs/validation` persistence-free and put the `ValidationRuleEntity`
    + repository in the *consuming* app/lib instead (e.g. `apps/server`). Rejected — every other
    `libs/*` package that needs its own persisted state (queue's outbox/inbox, workflow's typeorm
    adapter) owns that state itself and exports entities/migrations for the host to merge; scattering
    the entity into whichever app happens to use it first breaks that convention and makes the
    schema harder to find.
- Stored rules use a narrow field/operator/value grammar (`ValidationRuleOperator`: equals,
  not_equals, greater_than(_or_equal), less_than(_or_equal), in, not_in, contains, not_contains) —
  **no regex operator, no expression language, no arbitrary code evaluation.**
  - *Alternative rejected:* a regex operator. Rejected on security grounds — an admin-supplied
    regex evaluated against user input is a ReDoS vector, and validation-rule storage should not
    become an new unauthenticated-adjacent attack surface just because it's convenient. If pattern
    matching on stored rules becomes a real need, reintroduce it only with a bounded/non-backtracking
    matcher, as its own dated Design entry — not silently.
  - *Alternative rejected:* a full expression language (e.g. storing a JS/JSONLogic expression and
    evaluating it). Rejected for the same reason Design 001 rejected a rule DSL/registry: no stated
    requirement justifies it, and it reopens the "admin can break/exploit production validation"
    risk the narrow grammar exists to avoid.

**MEDIUM**
- Field access is top-level only (`candidate[rule.field]`, no dot-path/nested traversal). Keeps
  the evaluator a single, auditable `switch` with no path-parsing mini-language of its own. Revisit
  only if a concrete rule needs a nested field — don't add path syntax speculatively.
- Numeric comparison operators (`greater_than`, etc.) fail closed (specification not satisfied,
  with an explanatory message) when either operand isn't actually a number, rather than silently
  coercing or silently passing. A misconfigured stored rule should be visible as a validation
  failure, not a silent no-op.
- No caching of `findRules(targetType)` in this pass — every `ValidationRuleService.validateStored`
  call re-fetches from MySQL. Acceptable at the assumed scale (0.2); revisit only if this shows up
  as a real bottleneck (see `libs/cache`'s `multi-level` pattern as the natural fit if/when it does)
  — not adding it speculatively.
- `ValidationRuleStore` is a port (interface + `VALIDATION_RULE_STORE` token) with a
  `NoopValidationRuleStore` default (returns no rules), following the same
  no-op-default-the-host-can-override convention as `WORKFLOW_EVENT_PUBLISHER`/`WORKFLOW_METRICS`.
  `ValidationModule.forRoot({ rules: { enabled: true } })` swaps in `DatabaseValidationRuleStore`;
  omitting `rules` keeps existing consumers (which don't need DB-backed rules) working exactly as
  before, with no new dependency forced on them.

**LOW**
- No admin HTTP surface (CRUD endpoints for managing rules) in this pass — out of scope for "can
  validation rules be stored in DB," which is a storage/evaluation question, not an admin-UI
  question. Left as an explicit open item below rather than built speculatively.

## Rejected Alternatives

- Regex operator — see HIGH decision above (ReDoS risk).
- Full expression language / JSONLogic-style stored expressions — see HIGH decision above
  (reopens the Design 001 rule-DSL rejection without a stated need).
- Nested/dot-path field access — see MEDIUM decision above (unneeded complexity without a
  concrete rule that requires it).
- Caching `findRules()` results — deferred, not rejected outright; see MEDIUM decision above.

## CQRS Decision

Not applicable / rejected — unchanged from Design 001. Storing rules as rows doesn't introduce a
read/write model split; `findRules()` is a plain read.

## Event Sourcing Decision

Not applicable / rejected — unchanged from Design 001.

## Open Questions / Future Evolution

- Admin HTTP surface for managing stored rules (create/update/disable) — deferred until actually
  requested; the repository/entity support it, but no controller exists yet.
- Caching `findRules(targetType)` results (e.g. via `libs/cache`) if DB round-trips per validation
  call become measurable — deferred, not designed, per MEDIUM decision above.
- Whether stored rules should support cross-field conditions (comparing two fields on the same
  candidate rather than a field against a fixed stored value) — no concrete need yet.

## Handoff to Improvement Loop

- **Public API surface (additions):** `ValidationRuleOperator`, `StoredRule` interface,
  `StoredConditionSpecification`, `composeStoredRules`, `ValidationRuleStore` interface +
  `VALIDATION_RULE_STORE` token, `NoopValidationRuleStore`, `DatabaseValidationRuleStore`,
  `ValidationRuleService`, `ValidationRuleEntity`, `ValidationRuleRepository`,
  `VALIDATION_TYPEORM_ENTITIES`, `VALIDATION_MIGRATIONS`.
- **Module boundaries (revised):** `libs/validation` may now import `@/database` (types/decorators
  only — it never constructs a `DataSource` itself, same as `libs/queue`/`libs/workflow`). It must
  still never import `@/queue`, `@/workflow`, or `@/auth`.

---

# Design 003

**Library / Bounded Context:** libs/validation
**Date:** 2026-07-20

## Goal

Cache `findRules(targetType)` results, since every `ValidationRuleService.validateStored` call
currently re-fetches from MySQL. (Design 002 deferred this until "a measured bottleneck" — the
user asked for it explicitly before one was measured; proceeding on that explicit instruction,
not on a discovered need.)

## Scale/Team Context Assumed

Unchanged. A short TTL cache (default 30s) is enough — stored rules change rarely (an admin
editing them), so brief staleness after an edit is an acceptable tradeoff for removing a DB round
trip from a hot validation path.

## Bounded Contexts Identified

No change — caching is a read-path optimization, not a new responsibility.

## Key Decisions (with risk tag)

**MEDIUM**
- `libs/validation` gains an optional dependency on `@/cache` (type-only import of `CacheManager`)
  — following the exact precedent `libs/auth`'s `CacheAccessTokenDenylist` already set: import
  only the `CacheManager` *type*, never `@/cache`'s tokens or `CacheModule` itself, and never
  auto-wire it. The consuming app constructs the cache-wrapped store manually (via
  `ValidationModule.forRootAsync`'s new `rules.useFactory`/`rules.inject`, injecting `CACHE_MANAGER`
  from its own already-registered `CacheModule`) and hands the finished instance to
  `libs/validation`. `libs/validation` itself never imports `@/cache`'s runtime tokens or module.
  - *Alternative rejected:* have `ValidationModule` inject `CACHE_MANAGER` directly (a value
    import, not just a type) and build the cache-wrapped store internally. Rejected — it would be
    a *stronger* form of peer-lib coupling than any existing precedent uses, and Section 17 says
    prefer existing patterns over inventing new ones. The type-only + host-constructs approach
    achieves the same result with strictly less coupling.
- `ValidationModuleAsyncOptions` gains an optional `rules: { enabled, useFactory, inject }` shape
  (parallel to the existing top-level `useFactory`/`inject` for the error factory) so the host can
  supply an arbitrary `ValidationRuleStore` — caching is one use, not the only one this shape
  permits. `ValidationModuleOptions` (the synchronous `forRoot`) keeps its plain
  `rules: { enabled: boolean }` — a DI-resolved `CacheManager` isn't available at that point
  without a factory, same reason `AuthModule`'s cache-backed denylist requires `forRootAsync` too.
- `DatabaseValidationRuleStore` and `NoopValidationRuleStore` are now always registered as their
  own class providers (not just referenced via `useClass` under the `VALIDATION_RULE_STORE`
  token), so a custom `rules.useFactory` can inject `DatabaseValidationRuleStore` as a dependency
  to wrap. Both are side-effect-free to construct (no I/O happens until `findRules` is called), so
  this costs nothing when unused.

**LOW**
- Default TTL: 30 seconds, matching the `orders-l1` example TTL already used in
  `apps/server/src/app.module.ts`'s cache config — not a new convention.
- Cache key: `validation-rules:${targetType}` — namespaced the same way
  `CacheAccessTokenDenylist` namespaces its keys (`auth:denylist:${jti}`).

## Rejected Alternatives

- Direct `CACHE_MANAGER` token injection inside `libs/validation` — see MEDIUM decision above.
- A longer TTL / no TTL (cache until explicit invalidation on rule edit) — rejected for this pass:
  invalidating on write would mean `ValidationRuleAdminService` needs to know about the cache too,
  coupling the write path to the read path's caching choice. A short TTL accepts brief staleness
  instead, which is simpler and was not asked for to be otherwise.

## CQRS Decision

Not applicable — unchanged.

## Event Sourcing Decision

Not applicable — unchanged.

## Open Questions / Future Evolution

- Cache invalidation on rule write (vs. TTL-only staleness) — not built; revisit only if 30s
  staleness after an admin edit proves to actually matter in practice.

## Handoff to Improvement Loop

- **Public API surface (additions):** `CachedValidationRuleStore`.
- **Module boundaries (revised again):** `libs/validation` may now *type-only* import `@/cache`
  (`CacheManager`), on the same terms `libs/auth` already established: no runtime dependency on
  `@/cache`'s tokens or module, no auto-wiring — the host constructs and injects the cache
  wrapper itself via `ValidationModule.forRootAsync`.

---

# Design 004

**Library / Bounded Context:** libs/validation
**Date:** 2026-07-20

## Goal

Close the TTL-only staleness gap Design 003 explicitly left open: invalidate a stored rule's
cache entry on write, instead of waiting out the TTL, per the user's explicit request to
"complete" the open items.

## Scale/Team Context Assumed

Unchanged.

## Bounded Contexts Identified

No change.

## Key Decisions (with risk tag)

**MEDIUM**
- `ValidationRuleStore.invalidate(targetType)` is added directly to the existing interface,
  rather than introducing a second port/token. Every current implementer is one we control
  (`NoopValidationRuleStore`, `DatabaseValidationRuleStore`, `CachedValidationRuleStore`), so
  widening the interface is a same-repo, zero-external-consumer change — a no-op implementation
  for the two stores with nothing to invalidate, and a real cache-bust for
  `CachedValidationRuleStore`.
  - *Alternative rejected:* a second `VALIDATION_RULE_CACHE_INVALIDATOR` port, bound to whatever
    the read-path store resolves to. Rejected — aliasing two DI tokens to "the same instance" is
    fragile (`useExisting` only works if both tokens are wired to a class that actually satisfies
    both interfaces, silently breaking if a future `rules.useFactory` swaps in a store that
    doesn't). Folding `invalidate` into `ValidationRuleStore` itself removes that failure mode
    entirely — every implementer already must satisfy the one interface `ValidationRuleService`/
    `ValidationRuleAdminService` depend on.
- `ValidationRuleAdminService` now depends on `VALIDATION_RULE_STORE` in addition to
  `ValidationRuleRepository`, calling `store.invalidate(targetType)` after `create`/`update`/
  `remove`. This is the first place the write path (admin service) and read path (rule store)
  share a dependency — acceptable because `invalidate` is the *only* thing being shared, and it's
  a narrow, one-directional signal ("this targetType changed"), not a broader coupling.

**LOW**
- `update`/`remove` need the `targetType` of the row being mutated (not just its `id`) to know
  which cache key to invalidate — fetched from the entity already being loaded/returned by the
  existing `updateRule`/`findById` calls, no extra query added.

## Rejected Alternatives

- Separate invalidation port/token — see MEDIUM decision above.
- Fire full cache `clear()` instead of a targeted `invalidate(targetType)` — rejected as needlessly
  broad; a single admin edit to one `targetType`'s rules shouldn't evict every other cached
  target type's entry too.

## CQRS Decision

Not applicable — unchanged.

## Event Sourcing Decision

Not applicable — unchanged.

## Open Questions / Future Evolution

- None — this closes the specific gap Design 003 flagged.

## Handoff to Improvement Loop

- **Public API surface (revised):** `ValidationRuleStore` now requires `invalidate(targetType)` —
  a breaking change to the interface shape, but every implementer in this repo is already updated;
  no external consumer exists today.

---

# Design 005

**Library / Bounded Context:** libs/validation
**Date:** 2026-07-20

## Goal

Support cross-field stored conditions — comparing two fields on the same candidate (e.g. "endDate
must be after startDate") — rather than only a field against a fixed stored value.

## Scale/Team Context Assumed

Unchanged.

## Bounded Contexts Identified

No change.

## Key Decisions (with risk tag)

**HIGH**
- Add one nullable column, `compareField: string | null`, to the existing `validation_rule`
  table (via an `ALTER TABLE` migration, not a new `CREATE TABLE`) rather than a new rule "type."
  When set, evaluation compares `candidate[field]` against `candidate[compareField]` instead of
  the stored `value` literal. `value` stays required and is simply ignored when `compareField` is
  set, rather than becoming conditionally-required — keeps `CreateValidationRuleDto` unchanged
  (still requires `value`), at the cost of `value` being a slightly-wasted field on cross-field
  rows. Classified HIGH per Section 18 (database schema change on an existing, already-deployed
  table), not because the change itself is risky — it's purely additive/nullable, so existing
  rows and existing rules with no `compareField` behave identically.
  - *Alternative rejected:* a discriminated union at the DTO/entity level (`{ mode: 'literal',
    value } | { mode: 'field', compareField }`), making `value`/`compareField` mutually exclusive
    and required-one-of. Rejected for this pass — more type-safe, but a bigger schema/DTO
    reshape than the feature needs; the nullable-column approach is additive and reversible if
    the mutual-exclusivity constraint turns out to matter later.
- Cross-field comparison is restricted to `equals`/`not_equals`/`greater_than(_or_equal)`/
  `less_than(_or_equal)` — **not** `in`/`not_in`/`contains`/`not_contains`. Those four operators
  are defined in terms of "is X a member of/substring of Y," and stored `value` for them is
  expected to be an array/string, not a second field name; allowing `compareField` there would
  require deciding what "the other field is an array" even means for `in`. Rejected as unneeded
  complexity — no concrete rule needs it. `evaluateStoredRule` fails closed (not satisfied, with
  a reason) if `compareField` is set alongside one of those four operators.

**MEDIUM**
- Same fail-closed behavior as literal comparisons: if `candidate[compareField]` is missing or
  the wrong type for the operator (e.g. comparing a string field with `greater_than`), the rule is
  not satisfied with an explanatory reason — consistent with Design 002's existing MEDIUM
  decision for literal comparisons, not a new pattern.

## Rejected Alternatives

- Discriminated union DTO/entity shape — see HIGH decision above.
- Extending `in`/`not_in`/`contains`/`not_contains` to support `compareField` — see HIGH decision
  above.

## CQRS Decision

Not applicable — unchanged.

## Event Sourcing Decision

Not applicable — unchanged.

## Open Questions / Future Evolution

- Whether `value` should become properly optional/mutually-exclusive with `compareField` at the
  DTO level — deferred; revisit if the "wasted field" cost of the current approach actually
  bothers someone authoring rules.

## Handoff to Improvement Loop

- **Public API surface (additions):** `ValidationRuleEntity.compareField`,
  `StoredRule.compareField`, `CreateValidationRuleInput`/`UpdateValidationRuleInput` gain optional
  `compareField`, a new migration `AddCompareFieldToValidationRule`.
- **Schema:** `validation_rule` gains a nullable `compareField VARCHAR` column via `ALTER TABLE`.

---

# Design 006

**Library / Bounded Context:** libs/validation
**Date:** 2026-07-20

## Goal

Extend cross-field comparison (`compareField`) to `in`/`not_in`/`contains`/`not_contains`, per
the user's explicit request to complete this previously-rejected item.

## Scale/Team Context Assumed

Unchanged.

## Key Decisions (with risk tag)

**MEDIUM**
- Design 005 rejected this on the grounds that "what does 'the other field is an array' even
  mean for `in`" was unresolved. Revisiting it now: the answer turns out to be the same
  generalization already applied to `equals`/`not_equals`/numeric comparisons — every operator's
  existing definition already treats `rule.value` as "the thing to compare against"; swapping in
  `candidate[compareField]` in its place is well-defined per operator with no new ambiguity:
  - `in`/`not_in`: `candidate[compareField]` must itself be an array (same requirement `rule.value`
    already had); membership is checked against it instead of the literal.
  - `contains`/`not_contains`: `candidate[compareField]`'s resolved value becomes the "needle"
    (same role `rule.value` already played) — no type constraint changes.
  - This was not a real ambiguity, just an under-examined one in Design 005 — corrected now
    rather than left as a permanent restriction.
- `evaluateMembership`/`evaluateContains` now take a resolved `comparisonValue` parameter (mirrors
  the numeric-comparison functions' existing shape) instead of hardcoding `rule.value` — the same
  refactor Design 005 already did for `equals`/`not_equals`/numeric operators, now applied
  uniformly to all ten.
- `CROSS_FIELD_SUPPORTED_OPERATORS` is removed entirely — every operator now supports
  `compareField`, so the fail-closed "operator does not support cross-field comparison" branch
  is now dead code and removed with it.

## Rejected Alternatives

- Leaving `in`/`not_in`/`contains`/`not_contains` restricted, per Design 005 — superseded above;
  the restriction wasn't protecting against a real risk (no security/ambiguity concern like the
  regex/expression-language rejections in Design 002/005), it was just unexamined.

## CQRS / Event Sourcing Decisions

Unchanged.

## Open Questions / Future Evolution

- None — this closes the specific item Design 005 left restricted.

## Handoff to Improvement Loop

- **Public API surface:** no shape change — `compareField` already existed on `StoredRule`/
  `ValidationRuleEntity`; this only widens which operators honor it.

---

# Design 007

**Library / Bounded Context:** libs/validation
**Date:** 2026-07-20

## Goal

Make `value` nullable/optional wherever a rule's `compareField` is set — a gap Design 006 left
unaddressed: once every operator honored `compareField`, requiring a literal `value` on a
cross-field-only rule (evaluator never reads `rule.value` when `compareField` is set — see
`rule-evaluator.ts`) was enforcing a constraint the domain no longer needed.

## Scale/Team Context Assumed

Unchanged.

## Key Decisions (with risk tag)

**HIGH** (schema change)
- `validation_rule.value` column: `json NOT NULL` → `json NULL`, via migration
  `MakeValidationRuleValueNullable1753400000000` (`changeColumn`, reversible `down`).
- `ValidationRuleEntity.value` and `CreateValidationRuleInput.value` become optional; repository
  defaults omitted `value` to `null` on create (stored as JSON null, not left undefined).

**MEDIUM**
- `CreateValidationRuleDto.value`: `@IsDefined()` (always required) → `@ValidateIf(dto =>
  !dto.compareField)` + `@IsDefined()` (required only when `compareField` is absent). Mirrors the
  domain invariant the evaluator already enforces implicitly.
- `UpdateValidationRuleDto.value` needed no change — already `@IsOptional()` for partial-update
  semantics, independent of this fix.

## Rejected Alternatives

- Leaving `value` required and asking callers to pass a placeholder (e.g. `null` or `0`) for
  cross-field rules — rejected as a leaky API: the DTO would be lying about what's semantically
  required.

## CQRS / Event Sourcing Decisions

Unchanged.

## Open Questions / Future Evolution

- None.

## Handoff to Improvement Loop

- **Public API surface:** `POST /validation-rules` — `value` is no longer required when
  `compareField` is provided (backward compatible: existing callers that always send `value`
  still work).
- **Schema:** `validation_rule.value` is now nullable.

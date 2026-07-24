# Design 001

**Library / Bounded Context:** libs/users (User Profile & Account Management)
**Date:** 2026-07-23

## Goal

Scope the platform's first real domain library — User Management, per `REQUIREMENTS.md` Tier 2 —
before writing any code. `REQUIREMENTS.md` flags this explicitly: "run `ci.loop` Section 0 (Design
Mode) before implementation to fix the aggregate boundary and its relationship to `libs/auth`,
since every later domain module depends on it." This session also resolves the sequencing question
that came up while scoping `libs/auth`'s deferred authorization policy-engine work (Tier 1): that
work has no concrete owned resource to design against yet, and this library's aggregate is meant to
supply the first one.

## Scale/Team Context Assumed

Unchanged from every prior Design Mode session in this monorepo (`libs/auth`, `libs/ratelimit`):
single maintainer, single Nest monorepo, `apps/server` horizontally scaled behind shared MySQL/
Redis, no stated tenant count or throughput target, no stated multi-region need. Sections 0.9–0.18
(team topology, multi-region, full event sourcing) collapse to "not applicable" per Section 0.1 —
flagging explicitly per that section's instruction, not silently skipping them.

## Context Gathering (Section 0.2)

- **What already exists:** `libs/auth`'s `UserEntity` (`auth_users`) owns `id`, `email`,
  `passwordHash`, `passwordAlgo`, `status` (`unverified`/`active`/`disabled`), `emailVerifiedAt`,
  and the RBAC `roles` association. `libs/auth/ARCH.md` Design 001 is explicit that this is the
  **Identity & Access** bounded context — credentials and login lifecycle — and separately, in the
  same document's "Engines / Policies / Specifications" section, that a generic ABAC/resource-
  ownership policy engine was discussed and **rejected** until "a concrete need actually appears
  somewhere in the codebase," to be "designed against its real consumer" when it does.
- **Existing domain language:** every sibling `libs/*` (`auth`, `cache`, `database`, `queue`,
  `ratelimit`, `validation`, `workflow`) is a singular-noun infrastructure or generic-subdomain
  library. This is the first Core Domain library — the thing that differentiates this platform
  from generic infrastructure — so its module breakdown has no direct precedent to copy verbatim,
  only conventions (ports-with-no-op-defaults, `forRoot`/`forRootAsync`, flat entity-first layout,
  `BaseRepository`) to reuse.
- **No existing Organization/tenant concept anywhere in the codebase** — `libs/auth/ARCH.md`
  states this directly ("no stated tenant model anywhere in this monorepo"). Organization
  Management (`REQUIREMENTS.md` Tier 2, second item) explicitly depends on this design's output and
  is out of scope here (see Rejected Alternatives / Future Evolution).

## Bounded Contexts Identified

- **New bounded context: User Profile & Account (`libs/users`).** Owns the business-facing
  identity of a user — display name, avatar, contact/locale preferences, business-level account
  lifecycle (deactivation for product reasons) — as distinct from `libs/auth`'s Identity & Access
  context, which owns credentials and the login-gating status enum. This is this platform's actual
  **Core Domain**: the thing product features (notifications, audit, future org membership) will
  actually reference, whereas Identity & Access remains a Generic Subdomain underneath it (per
  `libs/auth/ARCH.md`'s own framing).
- **Does not absorb Identity & Access.** `libs/auth`'s `User` aggregate is not merged into this
  design or renamed — it continues to own credentials/login lifecycle exactly as today. Splitting
  "can this principal authenticate" from "who is this person, product-wise" is the same kind of
  boundary DDD conventionally draws between an Identity/Access context and a Profile/Account
  context, and avoids reopening `libs/auth`'s already-settled, 20-loop-stable aggregate (Section 18:
  don't re-litigate a design decision that still satisfies its original justification).
- **Does not absorb Organization Management.** No organization/tenant concept exists yet anywhere
  in this codebase to attach membership to; designing it speculatively here would be exactly the
  premature-generality Section 0.1 warns against. Flagged as the immediate next Design Mode session
  once this one lands (see Future Evolution).
- **Does not absorb a generic authorization policy engine.** See Key Decisions HIGH #3 — this
  design supplies the first concrete *consumer* for that work (ownership checks on `UserProfile`),
  it doesn't build the engine itself.

## Context Map

- **`libs/auth` (upstream, identity reference only — no code dependency).** `libs/users` never
  imports `@/auth`. The two contexts share a single identifier — `userId`, the same uuid
  `libs/auth`'s `UserEntity.id` already is — the way two bounded contexts in the same monorepo
  conventionally relate via a shared identity in a Shared Kernel sense, without one importing the
  other's internals. `apps/server`'s `JwtAuthGuard`/`@CurrentUser()` already put `userId` on every
  authenticated request; that's the only channel `libs/users` needs. No `AUTH_EVENT_PUBLISHER`
  subscription, no orchestration at registration time — see Key Decisions HIGH #1 for why.
- **`libs/database` (upstream, hard dependency).** Same pattern as every other domain lib:
  `UserProfileEntity` + `UserProfileRepository extends BaseRepository`, `USERS_TYPEORM_ENTITIES`/
  `USERS_MIGRATIONS` exported for the host to merge into its single `DatabaseModule.forRoot` call
  (`apps/server/src/app.module.ts` already merges five libraries' entities/migrations this way;
  this becomes the sixth).
- **`libs/cache`/`libs/queue`/`libs/workflow`/`libs/ratelimit`/`libs/validation`:** no relationship.
  Nothing in this design's scope needs caching, messaging, durable orchestration, or rate limiting;
  `@/validation`'s bare `Specification` interface is reused for the one uniqueness-shaped check this
  design has (see Application Layer), matching `libs/auth/ARCH.md` Design 002's precedent exactly.
- **Future `libs/organizations` (downstream, not yet built):** will reference `UserProfile` by
  `userId` the same decoupled way this design references `libs/auth`'s `User` — flagged, not
  designed.

No cyclic dependency: `libs/users` depends on `libs/database` and `libs/validation` (both stateless
infrastructure, same class of dependency `libs/auth` already takes directly); nothing depends back
on `libs/users` yet.

## Architecture Style Recommendation

Modular monolith, unchanged from every sibling library. Nothing about profile/account management at
this scale justifies a separate service — no independent-deployment or team-count pressure exists
(Section 0.3's default-to-Modular-Monolith-unless-justified rule).

## Module Breakdown

```
libs/users/src/
  index.ts                            # public barrel

  users.module.ts                     # UsersModule.forRoot/forRootAsync
  users.constants.ts                  # DI tokens
  users.types.ts                      # UsersModuleOptions / UsersModuleAsyncOptions

  domain/
    user-profile.entity.ts            # TypeORM entity (aggregate root)
    user-profile.repository.ts        # extends BaseRepository<UserProfileEntity>

  application/
    user-profile.service.ts           # getOrCreate/updateProfile/deactivate/reactivate,
                                       # assertOwnerOrPermission (the ownership-check consumer)

  specifications/
    unique-display-name.specification.ts   # OPTIONAL — see Rejected Alternatives; only if
                                            # display-name uniqueness turns out to be a real
                                            # requirement, not built speculatively now

  dto/
    update-profile.dto.ts
    user-profile-response.dto.ts

  errors/
    user-profile-not-found.error.ts
    forbidden-profile-access.error.ts

  http/
    user-profile.controller.ts        # GET/PATCH /users/me, GET /users/:userId (admin)

  persistence/
    entities/index.ts                 # USERS_TYPEORM_ENTITIES
    migrations/index.ts               # USERS_MIGRATIONS
      <timestamp>-InitialUsersSchema.migration.ts
```

This mirrors `libs/auth`'s flat `domain/application/dto/errors/persistence` layout exactly — no new
folder convention invented (Section 0.3's folder-structure rule).

## Aggregate Design

- **`UserProfile` (aggregate root).** Invariants: `userId` unique (one profile per authenticated
  identity) and immutable after creation; `displayName` has a length bound but no cross-user
  uniqueness requirement (see Rejected Alternatives); `deactivatedAt` is a one-way business-level
  flag independent of `libs/auth`'s `status` enum (a profile can be deactivated — hidden from other
  users, e.g. — without touching whether its owner can still log in; the two lifecycles are owned
  by different contexts and answer different questions).
- Kept intentionally small (no address book, no preferences sub-entities, no avatar-versioning
  history) — nothing in the current requirements set calls for more, and Section 17 ranks Simplicity
  above speculative Performance/extensibility.

## Domain Model

- `UserProfileEntity`: `id (uuid, own primary key — not reusing auth's userId as PK, so this
  aggregate has its own identity lifecycle independent of how libs/auth models its rows)`,
  `userId (uuid, unique, indexed — the shared identifier, not a database-level foreign key; see Key
  Decisions MEDIUM #1)`, `displayName`, `avatarUrl?`, `bio?`, `locale?`, `timezone?`,
  `deactivatedAt?`, `createdAt`, `updatedAt`.
- Domain exceptions: `UserProfileNotFoundError` (404), `ForbiddenProfileAccessError` (403 — thrown
  by the ownership check described below).

## Application Layer (Use Cases)

- `UserProfileService.getOrCreate(userId)` — the only creation path. Looks up by `userId`; if
  absent, creates a default-shaped row (`displayName` seeded from... nothing available at this
  layer, so it starts blank/placeholder and the owner fills it in via `updateProfile`). No
  registration-time orchestration call from `libs/auth` — see Key Decisions HIGH #1.
- `UserProfileService.updateProfile(userId, actingUserId, patch)` — calls
  `assertOwnerOrPermission` first.
- `UserProfileService.deactivate/reactivate(userId, actingUserId)` — same ownership gate.
- **`UserProfileService.assertOwnerOrPermission(profile, actingUserId, permission)`** — the
  concrete answer to the deferred `libs/auth` authorization work: `actingUserId === profile.userId
  ? allow : delegate to AuthorizationService.hasPermission(actingUserId, permission)`. This *is* the
  resource-level/ownership check REQUIREMENTS.md's Tier 1 item asked for — expressed here as a
  two-line comparison against a real aggregate, not as a generic policy engine (see Key Decisions
  HIGH #3). `libs/users` takes a direct dependency on `@/auth`'s exported `AuthorizationService`
  for the permission-override half of this check only (not the reverse direction — `libs/auth` still
  never imports `libs/users`).
- `UpdateProfileDto` validated via `class-validator`, matching every existing DTO in the monorepo.

## Commands / Queries

CQRS rejected (see below) — same plain repository/service split as `libs/auth`.

## Events

None in this design's scope. No other bounded context needs to react asynchronously to a profile
change yet; if Organization Management later needs to know when a profile is deactivated, that's an
addition to make when that consumer exists (matching `libs/auth`'s own precedent: `AUTH_EVENT_
PUBLISHER` was built with real methods only once real callers existed, not speculatively upfront).

## Engines / Policies / Specifications

- **No generic policy engine** — see Application Layer's `assertOwnerOrPermission` and Key
  Decisions HIGH #3. This is the concrete first consumer the deferred `libs/auth` policy-engine
  discussion was waiting for; it turned out to need two branches, not a framework.
- **`Specification` reuse** (optional, see Rejected Alternatives) only if display-name uniqueness
  becomes a real requirement — not built in this pass.

## Workflows / Sagas

None. Every use case is a single-row read or write; no multi-step process, no compensation.

## Data Architecture

Single transactional datastore — MySQL via `@/database`, same writer/reader-split datasource every
other domain lib rides. `user_profiles` is a low-write-volume table (one row per user, edited
occasionally); no special sharding/partitioning need.

## Messaging Architecture

None — no direct or ported broker dependency in this design's scope (see Events).

## Reliability Architecture

None needed — no multi-step process, no unreliable external call, no outbox/inbox/saga shape
anywhere in this use-case set.

## Security Architecture

- **Ownership enforcement is the security-critical surface of this library** — `assertOwnerOrPermission`
  must run on every mutating call; `UserProfileController` never trusts a client-supplied `userId`
  for a `PATCH /users/me`-shaped route (route derives the target from the *route itself* — `/me` —
  not from a body/query parameter, closing the class of bug where a client edits someone else's
  profile by passing a different id in the payload).
- **Admin/override path** reuses `libs/auth`'s existing `AuthorizationService.hasPermission` — no
  new permission-check machinery. A new `users:manage` permission (seeded via migration, same
  pattern `libs/auth`'s `roles:manage` used) is the override.
- No PII beyond what a profile explicitly is — no payment data, no government ID — so no additional
  compliance-specific handling in this design's scope (Compliance Module remains a separate,
  deferred `REQUIREMENTS.md` item).
- Multi-tenancy: not applicable — no tenant model exists (see Context Gathering).

## Scalability

Stateless service methods, no in-memory state — same horizontal-scaling story as `libs/auth`.
No bottleneck introduced beyond what `libs/database` already carries.

## Folder Structure

See Module Breakdown — matches `libs/auth`'s existing convention exactly.

## Design Patterns

- **Repository** (`UserProfileRepository extends BaseRepository`) — used, matches every sibling lib.
- **Facade**: `UserProfileService` is a thin facade over the repository plus the one ownership
  check — no additional layer needed.
- **Specification:** not used in this initial scope (see Rejected Alternatives) — the folder is
  reserved in the Module Breakdown for if/when display-name uniqueness becomes real.
- **Policy/Strategy/Factory/Builder/Chain of Responsibility:** not introduced — nothing in this
  scope has more than one implementation or one branch worth naming as a pattern.

## CQRS Decision

**Rejected.** Read/write volume is low and simple key-lookups (one row per user); no divergent read
model, no team-size pressure to split ownership.

## Event Sourcing Decision

**Rejected.** Current-state-only rows are sufficient; no consumer needs point-in-time replay of
profile history.

## Rejected Alternatives

- **Merging `UserProfile` fields directly onto `libs/auth`'s `UserEntity`.** Rejected — would
  reopen a bounded context `libs/auth/ARCH.md` already settled across 20 improvement loops, mixing
  a credentials/login-gating concern with a product-facing profile concern that has a materially
  different change cadence and a different owner-facing security model (self-editable profile vs.
  security-critical credential state). Section 18: don't re-litigate a decision that still
  satisfies its original justification.
- **A hard database foreign key from `user_profiles.userId` to `auth_users.id`.** Considered, since
  both tables live in the same physical MySQL datasource (`DatabaseModule.forRoot` already merges
  every lib's entities). Rejected in favor of a plain unique-indexed column: `libs/users` should
  stay independently testable (its own sqlite/integration tests, mirroring `libs/auth`'s own
  `TypeormTestDataSource` pattern) without needing `libs/auth`'s schema bootstrapped alongside it,
  and no sibling lib has taken a cross-domain-lib FK before (`libs/queue`/`libs/workflow` reference
  nothing user-shaped at all). Referential integrity is enforced at the application layer instead
  (`getOrCreate` only ever runs against an already-authenticated `userId`, which by construction
  came from a valid JWT `libs/auth` issued).
- **Registration-time orchestration** (`AuthService.register()` triggers profile creation
  synchronously, or via `AUTH_EVENT_PUBLISHER`). Rejected — either shape adds either a new
  `libs/auth → libs/users` dependency (backwards: a Generic Subdomain shouldn't need to know a Core
  Domain built on top of it exists) or a new multi-write-atomicity requirement identical to the one
  `libs/auth/ARCH.md` Design 006 already flagged and declined to solve speculatively. Lazy
  `getOrCreate(userId)` on first access sidesteps both: no coupling, no atomicity problem, and every
  authenticated request already carries a valid `userId` to create against.
- **Display-name uniqueness enforcement.** Considered (mirroring `libs/auth`'s `Specification`
  precedent for role/permission/email uniqueness) and left out of this initial scope — no stated
  requirement yet that display names must be unique (unlike email, which gates login). Flagged in
  Module Breakdown as an easy addition (`UniqueDisplayNameSpecification`, same shape as `libs/auth`'s
  three existing specifications) if that requirement appears.
- **Organization/tenant membership as part of this design.** Rejected — no organization concept
  exists yet anywhere in the codebase; designing membership against a context that doesn't exist
  would be pure speculation. This is exactly why `REQUIREMENTS.md` orders Organization Management
  after User Management and ties its scope to this design's output.
- **A generic ABAC/resource-ownership policy engine as part of this design.** Rejected — this design
  intentionally supplies the first concrete consumer (`assertOwnerOrPermission`) instead of the
  engine. If a *second*, materially different ownership shape appears later (e.g. Organization
  membership-scoped checks, not just single-owner equality), that's the trigger to revisit whether a
  shared abstraction is warranted — not before.

## Key Decisions (with risk tag)

**CRITICAL**
- None. Nothing here reaches monolith-vs-microservices, broker-choice, or multi-tenant-isolation
  territory.

**HIGH**
1. **`libs/users` never imports `@/auth`; `UserProfile` is created lazily via `getOrCreate(userId)`
   on first access, not orchestrated at registration time.** Benefits: zero new coupling between a
   Generic Subdomain and the Core Domain built on top of it; no multi-write-atomicity problem to
   solve (see Rejected Alternatives). Risk: a user who registers but never calls any `/users/*`
   route has no profile row — acceptable, since every route that would need one calls
   `getOrCreate` itself as its first step; there's no scenario where a profile is needed but
   absent. Alternative rejected: registration-time orchestration (see Rejected Alternatives).
   Evolution: if a product need emerges for guaranteed-present profiles (e.g., a nightly admin
   report joining every `auth_users` row against `user_profiles`), revisit as a real requirement,
   not speculatively now.
2. **`UserProfile` is a separate bounded context/aggregate from `libs/auth`'s `User`, joined only
   by a shared `userId`.** Benefits: keeps `libs/auth`'s settled, 20-loop-stable Identity & Access
   context untouched; gives product-facing profile data its own change cadence and its own
   (weaker) security model, distinct from credential state. Risk: two lookups (auth for identity,
   users for profile) instead of one join — acceptable at this scale/data volume. Alternative
   rejected: merge onto `UserEntity` (see Rejected Alternatives). Evolution: none anticipated —
   this mirrors a standard DDD Identity-vs-Profile split.
3. **The deferred `libs/auth` authorization policy-engine item is resolved here as a two-branch
   ownership check (`assertOwnerOrPermission`), not a generic engine.** Benefits: ships the actual
   `REQUIREMENTS.md` Tier 1 need ("resource-level/ownership checks") against a real consumer,
   exactly as `libs/auth/ARCH.md` said to wait for; avoids building unused generality. Risk: if a
   second, structurally different ownership shape appears later (group/org-scoped, not just
   single-owner), this two-branch check won't generalize automatically. Alternative rejected: build
   a policy engine now, speculatively (see Rejected Alternatives). Evolution: the trigger to build a
   shared abstraction is a second, differently-shaped ownership consumer — not before.

**MEDIUM**
1. `user_profiles.userId` is a plain unique-indexed column, not a database foreign key into
   `auth_users` — see Rejected Alternatives. Keeps `libs/users` independently testable and
   consistent with the fact that no sibling lib has taken a cross-domain-lib FK before.
2. `libs/users` takes a direct dependency on `@/auth`'s `AuthorizationService` for the
   permission-override half of `assertOwnerOrPermission` only — the same class of direct
   infrastructure-ish dependency `libs/auth` already takes on `@/database`/`@/validation`, not a
   port, since `AuthorizationService` (like `BaseRepository`) isn't a swappable cross-cutting
   concern with multiple real implementations, just a shared, stable service.
3. `libs/users` also depends directly on `@/validation` only if the optional `Specification` folder
   is ever populated (see Rejected Alternatives) — not taken in this initial scope.

**LOW**
- Library named `libs/users` (plural, resource-collection style) rather than `libs/user` —
  matches `REQUIREMENTS.md`'s own "User Management" naming and reads naturally as the owner of the
  `/users/*` route namespace; no functional difference either way.
- Folder layout, file naming — see Module Breakdown, mirrors `libs/auth` exactly.

## Open Questions / Future Evolution

- **Organization Management is the next Design Mode session**, once this design's `UserProfile`
  aggregate exists to attach membership to (per `REQUIREMENTS.md` Tier 2's explicit ordering).
- **If a second, structurally different resource-ownership shape appears** (e.g., an
  Organization-scoped "any org admin can edit any member's X" check, not just single-owner
  equality), that's the concrete trigger to revisit whether `assertOwnerOrPermission`'s two-branch
  shape should generalize into a small reusable helper — still short of a full policy engine unless
  a third, materially different shape also appears.
- **Display-name uniqueness** — not required today; add `UniqueDisplayNameSpecification` if it
  becomes one (see Rejected Alternatives).
- **Guaranteed-present profiles** (e.g. for a report join) — not needed today; would be the trigger
  to reconsider the lazy-creation decision (HIGH #1).

## Handoff to Improvement Loop

- **Public API surface (`libs/users/src/index.ts`, once implemented):** `UsersModule`
  (`forRoot`/`forRootAsync`), `UserProfileService`, `UserProfileNotFoundError`,
  `ForbiddenProfileAccessError`, `UpdateProfileDto`, `UserProfileResponseDto`,
  `USERS_TYPEORM_ENTITIES`, `USERS_MIGRATIONS`.
- **Module boundaries:** `libs/users` → `@/database` (hard dependency, entities/repositories) and
  `@/auth` (direct dependency on `AuthorizationService` only, for the permission-override branch of
  ownership checks — not a port, see Key Decisions MEDIUM #2). `@/auth` gains no new dependency in
  either direction — it still never imports `libs/users`. `apps/server/src/app.module.ts` needs
  `USERS_TYPEORM_ENTITIES`/`USERS_MIGRATIONS` merged into its existing `DatabaseModule.forRoot`
  call and a `users:manage` permission seeded via migration, the same way `libs/auth`'s
  `roles:manage` was seeded.
- **First Improvement Loop should implement exactly this scope** — `UserProfile` CRUD +
  `assertOwnerOrPermission` + the controller/DTOs/errors above — and no more. Organization
  Management, event integration, and any generalized policy engine are explicitly out of scope
  until their own stated trigger (see Open Questions).

---

# Design 002

**Library / Bounded Context:** libs/users
**Date:** 2026-07-23

## Goal

Record the new `@/audit` dependency taken on by `UserProfileService.updateMine` when
`libs/audit/ARCH.md` Design 001 wired profile updates into the new Audit Module.

## Key Decisions (with risk tag)

**MEDIUM**
- `UserProfileService` now constructor-injects `AuditService` and calls `.record(...)` at the end
  of `updateMine`, using the (self-only) `userId` as both actor and target. No signature change —
  `updateMine` already took the acting user's id as its first parameter.

## Handoff to Improvement Loop

- **Public API surface:** unchanged.
- **Module boundaries (revised):** `libs/users` → `@/audit` (direct dependency on `AuditService`),
  in addition to the already-established `@/database`/`@/auth` dependencies.

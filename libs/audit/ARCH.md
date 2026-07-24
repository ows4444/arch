# Design 001

**Library / Bounded Context:** libs/audit
**Date:** 2026-07-23

## Goal

Scope a new Audit Module — `REQUIREMENTS.md` Tier 1, flagged as MEDIUM risk and "no new
architecture required" (hooks into existing `libs/database` repositories/transactions). Started now
because two concrete, security/compliance-relevant mutation surfaces already exist to audit:
`libs/auth`'s 8 RBAC mutation methods (`AuthorizationService`) and `libs/users`'
`UserProfileService.updateMine`.

## Scale/Team Context Assumed

Unchanged from every prior Design Mode session: single maintainer, single Nest monorepo, no stated
tenant/throughput target. Sections 0.9–0.18 collapse to "not applicable."

## Bounded Contexts Identified

- **Audit — a generic cross-cutting infrastructure concern**, same class as `libs/cache`/
  `libs/ratelimit`, not a domain library. It records "who did what, to what, when" for mutations
  other libraries decide are worth recording; it has no domain knowledge of RBAC or profiles
  itself.

## Context Gathering (Section 0.2) — Mechanism & Scope

Two decisions confirmed directly with the user before designing further (offered as
recommendations, both accepted):

- **Mechanism: direct service call**, not a decorator/interceptor/provider-enhancer. Domain
  services take a direct constructor dependency on `AuditService` and call `.record(...)` at each
  mutation point — the same shape `libs/users`' `UserProfileService` already uses for
  `AuthorizationService` (a stable shared service, not a swappable cross-cutting port). Rejected
  alternative: a new `@Audited()` decorator + method enhancer (mirroring `@Transactional`'s
  provider-enhancer mechanism) — more decoupled, but is exactly the "new architecture" this item
  was scoped to avoid, and `libs/auth/ARCH.md` Design 006 already found `@Transactional()`-style
  enhancers have zero consumers anywhere in this monorepo; introducing a second such mechanism for
  one new concern isn't justified yet.
- **Scope: RBAC + profile mutations.** `AuthorizationService`'s 8 mutation methods
  (`createPermission`, `createRole`, `deleteRole`, `deletePermission`, `grantPermission`,
  `revokePermission`, `assignRole`, `revokeRole`) and `UserProfileService.updateMine`. Narrower
  scopes (RBAC only) and broader ones (every write in every lib) were both on the table; broader
  was rejected outright — auditing every internal write (queue outbox rows, workflow state
  transitions, cache operations) would be noise, not a security/compliance trail, and no library
  besides `libs/auth`/`libs/users` has a mutation anyone asked to audit.

## Context Map

- **`libs/database` (upstream, hard dependency).** Same pattern as every other lib: `AuditEntry`
  entity + `AuditLogRepository extends BaseRepository`, `AUDIT_TYPEORM_ENTITIES`/
  `AUDIT_MIGRATIONS` exported for the host's single `DatabaseModule.forRoot` call.
- **`libs/auth`/`libs/users` (downstream, new consumers).** Both take a direct dependency on
  `@/audit`'s `AuditService` and call `.record(...)` — the first two-direction check: does this
  create a cycle? No — `libs/audit` takes **no** dependency on `@/auth` or `@/users` in return (see
  next point), so the dependency is strictly one-directional: `libs/auth`/`libs/users` → `libs/audit`
  → `libs/database`.
- **Deliberately no HTTP surface in this design.** A read endpoint (`GET /audit`) would naturally
  want `libs/auth`'s `JwtAuthGuard`/`PermissionsGuard`, which would make `libs/audit` depend on
  `libs/auth` — creating exactly the cycle above (`libs/auth` → `libs/audit` → `libs/auth`).
  Resolved by keeping `libs/audit` guard-agnostic: it exports `AuditService`/`AuditLogRepository`
  only. If a read endpoint is wanted later, `apps/server` composes it at the host layer (already
  depends on everything, so no cycle), using `@/auth`'s guards + `@/audit`'s repository — the same
  "host composes cross-cutting concerns no single lib should own" precedent as
  `CacheAccessTokenDenylist` being wired in `app.module.ts` rather than inside `libs/auth`.
- **No relationship to `libs/cache`/`libs/queue`/`libs/workflow`/`libs/ratelimit`/`libs/validation`.**

No cyclic dependency: verified above.

## Architecture Style Recommendation

Modular monolith, unchanged. One more thin infrastructure library.

## Module Breakdown

```
libs/audit/src/
  index.ts                          # public barrel

  audit.module.ts                   # AuditModule.forRoot() — no options needed today

  domain/
    audit-entry.entity.ts           # TypeORM entity
    audit-log.repository.ts         # extends BaseRepository<AuditEntryEntity>

  application/
    audit.service.ts                # record(entry) — the only method; no list()/query
                                     # method added speculatively (Section 17: don't build
                                     # what nothing consumes yet)

  persistence/
    entities/index.ts               # AUDIT_TYPEORM_ENTITIES
    migrations/index.ts             # AUDIT_MIGRATIONS
      <timestamp>-InitialAuditSchema.migration.ts
```

## Aggregate Design

`AuditEntry` is not an aggregate in the DDD sense — no invariants beyond immutability (append-only;
nothing in this design ever updates or deletes a row). Modeled as a plain entity, same treatment
`libs/ratelimit`'s design gives its own non-aggregate persisted state.

## Domain Model

- `AuditEntryEntity`: `id (uuid)`, `actorId (varchar, nullable — null represents a system-
  initiated action with no acting user, not used by either initial consumer but kept nullable
  rather than forcing a fake actor id later)`, `action (varchar — e.g. 'role.created',
  'permission.granted', 'profile.updated')`, `targetType (varchar, nullable)`, `targetId (varchar,
  nullable)`, `metadata (json, nullable — secondary identifiers/details, e.g. `{ permissionName }`
  alongside a `role` target)`, `createdAt (datetime, default CURRENT_TIMESTAMP — the only
  timestamp; no `updatedAt`, since rows are never updated)`.

## Application Layer (Use Cases)

- `AuditService.record({ actorId?, action, targetType?, targetId?, metadata? })` — the only use
  case. Called *after* the primary mutation succeeds, as a separate, non-transactional write (no
  code path in this monorepo uses `@Transactional()` today — `libs/auth/ARCH.md` Design 006 — so
  this doesn't invent a new transactional-outbox-style guarantee for one write; if the audit write
  itself throws, the error propagates normally rather than being swallowed, since silently losing an
  audit record would defeat the point).

## Commands / Queries

Not applicable — one write-only use case, no query surface in this initial scope.

## Events

None.

## Engines / Policies / Specifications

None.

## Workflows / Sagas

None.

## Data Architecture

Single transactional datastore — MySQL via `@/database`, same writer/reader-split datasource every
other lib rides. Append-only, low-to-moderate write volume (bounded by how often RBAC/profile
mutations actually happen); no special partitioning need at this scale.

## Messaging / Reliability / Security / Scalability

- No messaging, no reliability pattern beyond "the write either succeeds or throws" (see
  Application Layer).
- Security: `AuditEntry` rows can contain the *names* of roles/permissions/actions taken (not
  secrets — no password hashes, tokens, or PII beyond an actor's uuid ever passed into `metadata`).
  Callers are responsible for not passing sensitive values into `metadata`; `AuditService` doesn't
  redact, since it has no domain knowledge of what's sensitive in a caller-supplied object.
- Scalability: append-only writes, no in-memory state — same story as every sibling lib.

## Folder Structure

See Module Breakdown — matches every sibling lib's flat layout.

## Design Patterns

- **Repository** (`AuditLogRepository extends BaseRepository`) — used.
- Nothing else — one entity, one write method, no branching logic worth naming a pattern.

## CQRS / Event Sourcing Decisions

Both rejected — single low-volume write path, no query side in this scope, no consumer needing
replay.

## Rejected Alternatives

- **Decorator + provider-enhancer mechanism** — see Context Gathering.
- **Auditing every write in every library** — see Context Gathering.
- **An HTTP read endpoint owned by `libs/audit`** — rejected to avoid a `libs/auth`↔`libs/audit`
  cycle (see Context Map); deferred to `apps/server` if/when a concrete need for one appears.
- **Wrapping the audit write and the primary mutation in one transaction** — no code path in this
  monorepo uses `@Transactional()` (see Application Layer); inventing that guarantee for this one
  new write isn't justified by a stated requirement.

## Key Decisions (with risk tag)

**CRITICAL**
- None.

**HIGH**
- None. Nothing here reaches a bounded-context boundary as significant as `libs/users`' — this is
  infrastructure, not a new Core Domain.

**MEDIUM**
1. `libs/auth` and `libs/users` each take a new direct dependency on `@/audit`. Confirmed no cycle
   results (see Context Map). Benefits: audits the two concrete mutation surfaces that motivated
   this module. Risk: every future audited mutation surface repeats this pattern (a new direct
   dependency per consumer) rather than a subscribe-once mechanism — acceptable at today's scale
   (two consumers); revisit if a third or fourth consumer makes the direct-dependency-per-consumer
   pattern feel repetitive (see Open Questions).
2. No HTTP read surface built in this pass — see Rejected Alternatives.

**LOW**
- Folder layout, file naming — matches every sibling lib.

## Open Questions / Future Evolution

- **A read endpoint** (`GET /audit`, permission-gated) — build in `apps/server` once there's a
  concrete need to actually view audit history, not speculatively now.
- **A third/fourth audited consumer** — if auditing spreads to more libraries and the
  direct-dependency-per-consumer pattern starts feeling repetitive, that's the trigger to revisit
  the decorator/enhancer alternative rejected above — not before.

## Handoff to Improvement Loop

- **Public API surface (`libs/audit/src/index.ts`):** `AuditModule` (`forRoot`), `AuditService`,
  `AuditEntryEntity`, `AUDIT_TYPEORM_ENTITIES`, `AUDIT_MIGRATIONS`.
- **Module boundaries:** `libs/audit` → `@/database` only. `libs/auth` and `libs/users` each gain a
  new direct dependency on `@/audit` (documented as a small addendum in each of their own ARCH.md
  files, per Section 0.7's precedent for a library taking on a new dependency — e.g. `libs/auth`
  Design 004's `@/ratelimit` note).
- **First Improvement Loop should implement exactly this scope**: `AuditEntry` + `AuditService`,
  wired as a call from each of the 8 `AuthorizationService` methods and `UserProfileService.
  updateMine`, plus tests. No HTTP surface, no query method, no second consumer beyond the two
  named.

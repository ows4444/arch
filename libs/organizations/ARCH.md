# Design 001

**Library / Bounded Context:** libs/organizations (Organization Management)
**Date:** 2026-07-24

## Goal

Scope the platform's second real domain library — Organization Management, per `REQUIREMENTS.md`
Tier 2 and `libs/users/ARCH.md` Design 001's Open Questions ("Organization Management is the next
Design Mode session, once this design's `UserProfile` aggregate exists to attach membership to").
That trigger has now fired: `libs/users` is implemented (Loops 001–002) and live-verified. This
session fixes the aggregate boundary and its relationship to `libs/users`/`libs/auth` before any
code is written, per Section 0's discipline.

Scope confirmed directly with the user before designing (two HIGH-risk calls, same pattern as
`libs/auth/ARCH.md` Design 005's device-cap confirmation):

- **v1 covers Organization + Membership only** — no invitation flow, no billing, no org settings.
  The smallest slice that gives "users belong to organizations" a real, usable shape.
- **Org-scoped roles are a new concept, independent of `libs/auth`'s global RBAC** — not a reuse of
  `libs/auth`'s `Role`/`Permission` entities.

## Scale/Team Context Assumed

Unchanged from every prior Design Mode session in this monorepo: single maintainer, single Nest
monorepo, `apps/server` horizontally scaled behind shared MySQL/Redis, no stated throughput target,
no stated multi-region need. Sections 0.9–0.18 collapse to "not applicable" per Section 0.1.

**Explicit non-goal, stated up front because this domain invites the confusion:** this is
**Organization the business object** (a named group a user can belong to — e.g. a company/team
account), not **tenant isolation infrastructure**. `REQUIREMENTS.md`'s Deferred/Rejected table
already says "Any multi-tenant framing — Platform is single-tenant; don't let Compliance/DevOps work
pull in tenant-isolation complexity uninvited." This design does not introduce per-request tenant
scoping, does not add a `tenantId` to `libs/auth`/`libs/users`/`libs/audit`/any other lib's queries,
and does not change how any existing library resolves its datasource. It is one more bounded
context with its own two tables, exactly like `libs/users` was — not a cross-cutting isolation
model. If a real multi-tenancy requirement appears later, that is a **separate, CRITICAL-tagged**
design decision to revisit explicitly (see Open Questions) — not something this session smuggles in.

## Context Gathering (Section 0.2)

- **What already exists:** `libs/users`' `UserProfile` (business-facing identity, `userId`-keyed,
  no FK into `libs/auth`) and `libs/auth`'s `User`/`Role`/`Permission` (credentials + global RBAC).
  `libs/users/ARCH.md` Design 001 explicitly left Organization Management out of its own scope
  ("no organization/tenant concept exists yet anywhere in the codebase") and flagged it as the next
  session, tied to *this* design's output, not the other way around.
- **Existing domain language:** `libs/users` is this platform's precedent for "second-ever Core
  Domain-adjacent library, built the same way infra libs are, joined to a sibling context only by a
  shared id." This design follows that precedent rather than inventing a new shape.
- **No existing owner-vs-member distinction anywhere in the codebase** other than
  `libs/users`' single-owner `assertOwnerOrPermission` (self vs. `users:manage` override). This
  design's Membership role model (owner/admin/member) is the **first materially different
  ownership shape** `libs/users/ARCH.md`'s Open Questions flagged as the trigger to reconsider
  generalizing ownership checks — noted here, addressed under Rejected Alternatives (not yet acted
  on: one new shape isn't the stated *second* + *third* bar that section set for building a shared
  abstraction, but it's flagged so the next loop doesn't have to rediscover it).

## Bounded Contexts Identified

- **New bounded context: Organization Management (`libs/organizations`).** Owns `Organization`
  (a named group) and `Membership` (a `UserProfile`'s participation in one `Organization`, carrying
  an org-scoped role). This is a **Supporting Domain** relative to `libs/users`' Core Domain — it
  extends what a user can belong to, but isn't itself the thing that differentiates the platform.
- **Does not absorb `libs/users`.** `UserProfile` is unchanged; `libs/organizations` references it
  by `userId` only, the same shared-kernel-by-id pattern `libs/users` already uses toward
  `libs/auth`.
- **Does not absorb `libs/auth`'s RBAC.** Org-scoped roles (owner/admin/member) are a small enum on
  `Membership`, not a reuse or extension of `Role`/`Permission` — confirmed with the user (see Goal).
  Global RBAC continues to answer "what can this principal do on the platform"; `Membership.role`
  answers a narrower, different question ("what can this principal do inside this one organization")
  — same kind of split `libs/users/ARCH.md` already drew between Identity/Access and Profile/Account.
- **Does not introduce a tenant-isolation model.** See Scale/Team Context Assumed.

## Context Map

- **`libs/users` (upstream, identity reference only — no code dependency).** `libs/organizations`
  never imports `@/users`. `Membership.userId` is the same uuid `UserProfile.userId` already is —
  shared kernel via id, exactly how `libs/users` relates to `libs/auth`. No FK across the lib
  boundary, same reasoning `libs/users/ARCH.md` gave for its own `userId` column (independent
  testability; no sibling lib has taken a cross-domain-lib FK).
- **`libs/auth` (upstream, permission-override reference only).** `libs/organizations` takes the
  same shape of dependency `libs/users` already takes: a direct dependency on `@/auth`'s exported
  `AuthorizationService`, used only for a platform-level override permission
  (`organizations:manage`, seeded the same way `users:manage`/`roles:manage` were) — for an admin
  fixing a broken organization without needing to already be a member. Not a second RBAC system;
  one narrow override permission, same pattern already established twice.
- **`libs/database` (upstream, hard dependency).** Same pattern as every other domain lib:
  `OrganizationEntity`/`MembershipEntity` + repositories extending `BaseRepository`,
  `ORGANIZATIONS_TYPEORM_ENTITIES`/`ORGANIZATIONS_MIGRATIONS` exported for the host to merge into
  its single `DatabaseModule.forRoot` call (becomes the seventh library merged there).
- **`libs/cache`/`libs/queue`/`libs/workflow`/`libs/ratelimit`/`libs/audit`/`libs/validation`:** no
  relationship in this design's scope, with one exception — `libs/audit`, whose existing
  direct-service-call pattern (`AuditService.record(...)`, no port/token, see `libs/audit/ARCH.md`
  Design 001) this design reuses exactly for organization/membership mutations, matching
  `libs/auth`/`libs/users`' own precedent.
- **Future consumers (not yet built):** anything Tier-2-downstream that wants org-scoped grouping
  (Compliance, Analytics/Reporting) would reference `Organization`/`Membership` by id the same
  decoupled way — flagged, not designed.

No cyclic dependency: `libs/organizations` depends on `libs/database`, `libs/auth`
(`AuthorizationService` only), and `libs/audit` (`AuditService` only) — the same three classes of
dependency `libs/users` already takes. Nothing depends back on `libs/organizations` yet.

## Architecture Style Recommendation

Modular monolith, unchanged. Nothing about organization/membership management at this scale
justifies a separate service.

## Module Breakdown

```
libs/organizations/src/
  index.ts                                  # public barrel

  organizations.module.ts                   # OrganizationsModule.forRoot/forRootAsync
  organizations.constants.ts                # DI tokens
  organizations.types.ts                    # OrganizationsModuleOptions / *AsyncOptions

  domain/
    organization.entity.ts                  # TypeORM entity (aggregate root)
    organization.repository.ts              # extends BaseRepository<OrganizationEntity>
    membership.entity.ts                    # TypeORM entity (aggregate root, see Aggregate Design)
    membership.repository.ts                # extends BaseRepository<MembershipEntity>
    membership-role.enum.ts                 # 'owner' | 'admin' | 'member'

  application/
    organization.service.ts                 # create/rename/delete, assertOrgPermission
    membership.service.ts                   # addMember/removeMember/changeRole/listMembers

  specifications/
    unique-organization-name.specification.ts   # OPTIONAL, see Rejected Alternatives — only if
                                                 # name uniqueness turns out to be a real requirement

  dto/
    create-organization.dto.ts
    organization-response.dto.ts
    membership-response.dto.ts
    change-member-role.dto.ts

  errors/
    organization-not-found.error.ts
    membership-not-found.error.ts
    forbidden-organization-access.error.ts
    already-a-member.error.ts
    cannot-remove-last-owner.error.ts

  http/
    organization.controller.ts              # POST /organizations, GET /organizations/:id,
                                             # DELETE /organizations/:id (owner/admin only)
    membership.controller.ts                # POST/DELETE /organizations/:id/members,
                                             # PATCH /organizations/:id/members/:userId (role change)

  persistence/
    entities/index.ts                       # ORGANIZATIONS_TYPEORM_ENTITIES
    migrations/index.ts                     # ORGANIZATIONS_MIGRATIONS
      <timestamp>-InitialOrganizationsSchema.migration.ts
      <timestamp>-SeedOrganizationsManagePermission.migration.ts
```

Mirrors `libs/users`' flat `domain/application/specifications/dto/errors/http/persistence` layout —
no new folder convention invented.

## Aggregate Design

- **`Organization` (aggregate root).** Invariants: `name` required, non-empty; `id` is its own uuid
  primary key. Deliberately thin — no settings, no billing plan, no logo/branding fields (confirmed
  v1 scope). Does not own `Membership` rows as an embedded collection — see next point.
- **`Membership` (separate aggregate root, not an `Organization` value object).** Reasoning:
  `libs/auth`'s own `RefreshToken` precedent — a row with independent lifecycle (created on join,
  mutated on role change, deleted on removal) and its own invariant (**"an organization must always
  have at least one `owner` membership"** — see Key Decisions HIGH #2) is more than a value object's
  worth of behavior. Composite-keyed by `(organizationId, userId)`, unique — one membership per user
  per organization, not a list a client could duplicate.
- **`Membership.role`**: `owner | admin | member`. `owner`: full control including deleting the
  organization and removing/promoting/demoting any member, including other owners. `admin`: can
  add/remove `member`-role users and change their role, cannot remove/demote an `owner`, cannot
  delete the organization. `member`: read-only membership, no management actions. (Three flat roles,
  not a permission matrix — matches `libs/users`' own "two branches, not a framework" restraint.)

## Domain Model

- `OrganizationEntity`: `id (uuid)`, `name`, `createdAt`, `updatedAt`.
- `MembershipEntity`: `id (uuid, own primary key — same reasoning `libs/users` gave for
  `UserProfile.id`: independent identity lifecycle)`, `organizationId (uuid, fk to
  `organizations.id`, `onDelete: 'CASCADE'` — deleting an org removes its memberships, mirroring
  `libs/auth`'s existing `role_permissions`/`user_roles` cascade precedent)`, `userId (uuid,
  unique-indexed, not an fk — same cross-domain-lib reasoning `libs/users` gave for not FK-ing into
  `auth_users`)`, `role (enum: owner/admin/member)`, `createdAt`, `updatedAt`. Unique composite index
  on `(organizationId, userId)`.
- Domain exceptions: `OrganizationNotFoundError` (404), `MembershipNotFoundError` (404),
  `ForbiddenOrganizationAccessError` (403), `AlreadyAMemberError` (409 — joining twice),
  `CannotRemoveLastOwnerError` (409 — the aggregate invariant from above, enforced at the service
  layer since TypeORM can't express "at least one row of this enum value exists" as a column
  constraint).

## Application Layer (Use Cases)

- `OrganizationService.create(name, ownerUserId)` — creates the `Organization`, then creates a
  `Membership(role: owner)` for `ownerUserId` in the same call (not a separate step a client could
  skip) — an organization with zero owners is never a state this service can produce.
- `OrganizationService.delete(organizationId, actingUserId)` — requires `assertOrgRole(actingUserId,
  organizationId, 'owner')` or the `organizations:manage` platform override; cascades memberships
  via the FK.
- `MembershipService.addMember(organizationId, targetUserId, role, actingUserId)` — requires
  `assertOrgRole(actingUserId, organizationId, 'admin')` (admin or owner); throws
  `AlreadyAMemberError` if the unique `(organizationId, userId)` constraint would be violated.
- `MembershipService.changeRole(organizationId, targetUserId, newRole, actingUserId)` — requires
  `assertOrgRole(actingUserId, organizationId, 'admin')`; additionally, only an `owner` can promote
  someone *to* `owner` or change another `owner`'s role — an `admin` cannot touch an `owner` row at
  all (enforced as an explicit extra check, not folded into the role hierarchy comparison, since
  "admin can manage admin" but "admin cannot manage owner" isn't a simple `>=` ordering).
- `MembershipService.removeMember(organizationId, targetUserId, actingUserId)` — requires
  `assertOrgRole(actingUserId, organizationId, 'admin')`; if `targetUserId` is the organization's
  last remaining `owner`, throws `CannotRemoveLastOwnerError` instead — the concrete enforcement
  point for the aggregate invariant (Key Decisions HIGH #2). A member can also remove *themselves*
  (leave) without needing `admin` — a self-removal branch, same "self vs. permission" shape
  `libs/users`' `assertOwnerOrPermission` already established, checked before the role gate.
- `MembershipService.listMembers(organizationId, actingUserId)` — requires the caller to be any
  member of the organization (or the platform override) — read access is member-wide, not
  admin-only.
- **`OrganizationService.assertOrgRole(actingUserId, organizationId, minRole)`** — the org-scoped
  authorization primitive this design introduces: look up the caller's `Membership` in this
  organization; if role satisfies `minRole` (owner > admin > member, except the owner-only carve-outs
  above, checked separately), allow; otherwise fall back to `AuthorizationService.hasPermission(
  actingUserId, 'organizations:manage')` (the platform override, same shape `libs/users`'
  `assertOwnerOrPermission` used for `users:manage`); otherwise throw
  `ForbiddenOrganizationAccessError`. Not present at all if the caller has no membership row and no
  override — same "403 before 404, don't leak existence" ordering `libs/users`' `getForUser`
  established.
- DTOs validated via `class-validator`, matching every existing DTO in the monorepo.

## Commands / Queries

CQRS rejected (see below) — same plain repository/service split as every sibling domain lib.

## Events

None in this design's initial scope. No other bounded context needs to react asynchronously to
organization/membership changes yet — matching `libs/users`' own precedent of adding events only
once a real consumer exists, not speculatively. Flagged under Open Questions as the first thing to
add if Compliance/Analytics ever needs to react to membership changes.

## Engines / Policies / Specifications

- **No generic policy engine** — `assertOrgRole` is a small, fixed three-role check plus one
  platform-override fallback, not a rule evaluator. This is the **second**, structurally different
  ownership shape `libs/users/ARCH.md`'s Open Questions flagged as worth *noting* (membership-role
  hierarchy vs. `libs/users`' flat self-vs-permission check) — but per that same document, the bar
  for building a shared abstraction was a *third* materially different shape, not a second. Recorded
  here as the second data point; not acted on (see Rejected Alternatives).
- **`Specification` reuse** (optional) only if organization-name uniqueness becomes a real
  requirement — not built in this pass, mirroring `libs/users`' own deferred
  `UniqueDisplayNameSpecification`.

## Workflows / Sagas

None. Every use case is a single-row or small-transaction read/write; no multi-step process, no
compensation. `OrganizationService.create`'s two writes (organization + owner membership) are the
only multi-write use case here — see Key Decisions MEDIUM #1 for whether that needs a transaction.

## Data Architecture

Single transactional datastore — MySQL via `@/database`, same writer/reader-split datasource every
other domain lib rides. Both tables are low-write-volume (organizations created rarely, memberships
change occasionally); no special sharding/partitioning need.

## Messaging Architecture

None — no direct or ported broker dependency in this design's scope (see Events).

## Reliability Architecture

None needed beyond the two-write atomicity question in Key Decisions MEDIUM #1 — no unreliable
external call, no outbox/inbox/saga shape anywhere in this use-case set.

## Security Architecture

- **`assertOrgRole` is the security-critical surface**, same role `assertOwnerOrPermission` plays
  in `libs/users` — must run on every mutating membership/organization call.
- **Route design avoids trusting client-supplied actor identity**: every controller method derives
  `actingUserId` from `@CurrentUser()` (the authenticated JWT subject), never from a body/query
  parameter — same closed class of bug `libs/users/ARCH.md` called out explicitly.
- **Platform override** (`organizations:manage`) reuses `libs/auth`'s existing
  `AuthorizationService.hasPermission` — no new permission-check machinery, seeded via migration
  the same way `users:manage`/`roles:manage` were.
- No PII beyond an organization name and a role enum — no payment data, no additional
  compliance-specific handling in this design's scope.
- **Explicitly not multi-tenancy**: see Scale/Team Context Assumed. No request-scoped tenant
  resolution, no change to any other library's query scoping.

## Scalability

Stateless service methods, no in-memory state — same horizontal-scaling story as every sibling
domain lib. No bottleneck introduced beyond what `libs/database` already carries.

## Folder Structure

See Module Breakdown — matches `libs/users`'/`libs/auth`'s existing convention exactly.

## Design Patterns

- **Repository** (`OrganizationRepository`/`MembershipRepository extends BaseRepository`) — used,
  matches every sibling lib.
- **Facade**: `OrganizationService`/`MembershipService` are thin facades over the repositories plus
  the role-check primitive — no additional layer needed.
- **Specification**: not used in this initial scope (see Engines/Policies above); folder reserved.
- **Policy/Strategy/Factory/Builder/Chain of Responsibility**: not introduced — `assertOrgRole`'s
  three-role-plus-override check is a single method, not a pattern-worthy abstraction yet (see
  Engines/Policies above on why a second data point isn't the generalization trigger).

## CQRS Decision

**Rejected.** Read/write volume is low; no divergent read model, no team-size pressure to split
ownership.

## Event Sourcing Decision

**Rejected.** Current-state-only rows are sufficient; no consumer needs point-in-time replay of
organization/membership history (that's what `libs/audit`'s append-only log already covers for the
mutations that matter — see Security Architecture / Context Map).

## Rejected Alternatives

- **Reusing `libs/auth`'s `Role`/`Permission` for org-scoped roles.** Offered explicitly to the user
  as an alternative; not chosen. Would require adding `organizationId` scoping to a settled,
  20-loop-stable global RBAC context that has no such concept today, reopening a boundary
  `libs/users/ARCH.md` deliberately avoided reopening for its own, smaller ownership check.
- **Invitation flow (pending invite → accept → membership) in this design's v1 scope.** Offered
  explicitly to the user as the larger option; not chosen. `MembershipService.addMember` is a direct
  admin-driven add for v1 — flagged under Open Questions as the natural v2 addition once a concrete
  product need for self-service joining appears.
- **Generalizing `assertOwnerOrPermission`/`assertOrgRole` into one shared ownership-check helper
  now.** Considered, since this is the second structurally different shape
  `libs/users/ARCH.md` flagged as worth watching. Rejected as premature — that document's own stated
  bar is a *third* differently-shaped consumer, not a second; forcing a shared abstraction across two
  data points risks guessing the wrong generalization. Flagged again here for the next candidate.
- **`Membership` as an embedded collection on `Organization`** rather than a separate aggregate root.
  Rejected — the last-owner invariant and independent create/update/delete lifecycle are more than a
  value object's worth of behavior (see Aggregate Design), same reasoning `libs/auth/ARCH.md` gave
  for `RefreshToken` being a separate aggregate from `User`.
- **A hard database foreign key from `memberships.userId` to `user_profiles.id` or `auth_users.id`.**
  Rejected for the same reason `libs/users` rejected an FK into `auth_users`: keeps
  `libs/organizations` independently testable without bootstrapping two other libs' schemas, and no
  sibling lib has taken a cross-domain-lib FK before. Referential integrity enforced at the
  application layer (every `userId` this service receives came from an already-authenticated JWT).
- **Tenant-scoping every other library's queries as part of this design.** Explicitly rejected — see
  Scale/Team Context Assumed. This is the guardrail this design most needs to state loudly, since
  "Organization" is the word that would normally trigger a multi-tenant redesign in a different
  codebase; `REQUIREMENTS.md` has already rejected that framing platform-wide.

## Key Decisions (with risk tag)

**CRITICAL**
- None. Nothing here reaches monolith-vs-microservices, broker-choice, or actual
  multi-tenant-isolation-model territory (see explicit non-goal above).

**HIGH**
1. **Org-scoped roles (`owner`/`admin`/`member`) are a new concept on `Membership`, not a reuse or
   extension of `libs/auth`'s global `Role`/`Permission`.** Confirmed directly with the user.
   Benefits: zero risk to `libs/auth`'s settled RBAC schema/semantics; org roles answer a narrower,
   different question than global RBAC, matching the Identity-vs-Profile-style split `libs/users`
   already established. Risk: two separate "role" concepts now exist in the platform (global
   `Role.name` strings, org `Membership.role` enum) — acceptable, since they govern genuinely
   different scopes and conflating them was the rejected alternative. Alternative rejected: reuse
   `libs/auth`'s `Role`/`Permission` with org scoping added (see Rejected Alternatives). Evolution:
   if a real requirement emerges for organization-specific *custom* permissions (not just three
   fixed roles), that's a new, larger design decision — not implied by this one.
2. **An organization must always have at least one `owner` membership; enforced at the service layer
   in `removeMember`/`changeRole`, not as a database constraint.** Benefits: prevents an
   unrecoverable "orphaned organization nobody can administer" state, the org-level analogue of
   `libs/auth`'s refresh-token-family-revocation invariant (a real domain rule, not a UI nicety).
   Risk: enforcement is only as good as every mutation path going through
   `MembershipService`, unlike a DB-level constraint — accepted because TypeORM/MySQL can't express
   "at least one row with `role = 'owner'` per `organizationId`" declaratively, and this mirrors how
   `libs/auth`'s own `RefreshToken`-family invariant is enforced in application code, not schema.
   Alternative rejected: no such invariant (allow zero-owner organizations) — rejected as a clear
   correctness gap, not a stylistic choice. Evolution: none anticipated.
   **Addendum (Loop 003 review):** the count check itself is a check-then-act race under true
   concurrency — two simultaneous `removeMember`/`changeRole` calls against two *different* owners of
   a two-owner organization could each read `count = 2` before either write commits, both proceed,
   and leave zero owners. Left as an accepted risk rather than fixed: a correct fix needs either
   `@Transactional()` + a pessimistic lock (`libs/auth/ARCH.md` Design 006 recorded that no library in
   this monorepo has `@Transactional()` working end to end, and `better-sqlite3` — every integration
   test's driver — can't execute `SELECT ... FOR UPDATE` at all) or an atomic conditional-update
   query, neither of which this design invests in speculatively for a single-maintainer-scale
   platform where concurrent owner-management is a low-probability edge case. Revisit if that
   assumption changes.
3. **v1 scope is Organization + Membership only — no invitations, no billing, no settings.**
   Confirmed directly with the user. Benefits: smallest slice that makes "users belong to
   organizations" real and testable, matching `libs/users` Design 001's own "ship the minimal
   aggregate, extend on a real trigger" discipline. Risk: `addMember` today requires the actor to
   already know the target's `userId` (no invite-by-email UX) — acceptable for v1; flagged under
   Open Questions as the natural v2. Alternative rejected: invitation flow in v1 (offered to the
   user, not chosen).

**MEDIUM**
1. `OrganizationService.create`'s two writes (organization row + owner membership row) are not
   wrapped in a database transaction in this initial design — consistent with `libs/auth/ARCH.md`
   Design 006's finding that no library in this monorepo actually uses `@Transactional()` today, and
   with the same "no concrete atomicity failure observed yet" reasoning that entry gave for not
   speculatively adding one. Risk: a crash between the two writes leaves an ownerless organization
   (the exact state Key Decisions HIGH #2 tries to prevent) — flagged explicitly as the first thing
   the Improvement Loop should evaluate wrapping in `@Transactional()` once implementation begins,
   since this is the one place in this design two writes must succeed together, unlike every other
   single-row use case here.
2. `memberships.userId` is a plain unique-indexed column, not a database foreign key — see Rejected
   Alternatives. Same reasoning `libs/users` already established for its own `userId` column.
3. `libs/organizations` takes a direct dependency on `@/auth`'s `AuthorizationService` (platform
   override permission only) and `@/audit`'s `AuditService` (mutation logging only) — the same two
   classes of direct, non-ported dependency `libs/users` already takes, not new precedent.

**LOW**
- Library named `libs/organizations` (plural), matching `libs/users`' own naming precedent and
  `REQUIREMENTS.md`'s "Organization Management" phrasing.
- Folder layout, file naming — see Module Breakdown, mirrors `libs/users` exactly.
- Migration timestamps continue the existing sequence — next available slot after
  `libs/audit`'s `1753600000000-InitialAuditSchema` is `1753700000000-InitialOrganizationsSchema` /
  `1753710000000-SeedOrganizationsManagePermission` (mirroring the `...500000000`/`...510000000`
  gap `libs/users` used for its schema + seed pair).

## Open Questions / Future Evolution

- **Invitation flow (invite-by-email → accept → membership)** is the natural v2 once a concrete
  product need for self-service joining appears (see Rejected Alternatives) — not designed now.
- **The `assertOwnerOrPermission` (libs/users) / `assertOrgRole` (this design) generalization
  question** — this is the second structurally different ownership shape `libs/users/ARCH.md`
  flagged. Per that document's own stated bar, a *third* differently-shaped consumer is the trigger
  to actually build a shared helper — not before. Noted here so the next candidate doesn't have to
  rediscover this history.
- **Transaction wrapping for `OrganizationService.create`** — flagged in Key Decisions MEDIUM #1 as
  the first concrete candidate in this monorepo for actually adopting `@Transactional()`, since
  every prior library found no real multi-write atomicity need. Revisit at implementation time, not
  deferred indefinitely.
- **Custom per-organization permissions** (beyond the fixed three-role model) — not needed today;
  would be the trigger to reconsider Key Decisions HIGH #1.
- **If a real multi-tenancy requirement is ever stated** (data isolation across organizations, not
  just membership grouping), that is an explicitly separate, CRITICAL-tagged design decision — this
  session deliberately does not pre-build toward it (see Scale/Team Context Assumed).

## Handoff to Improvement Loop

- **Public API surface (`libs/organizations/src/index.ts`, once implemented):**
  `OrganizationsModule` (`forRoot`/`forRootAsync`), `OrganizationService`, `MembershipService`,
  `MembershipRole` enum, `OrganizationNotFoundError`, `MembershipNotFoundError`,
  `ForbiddenOrganizationAccessError`, `AlreadyAMemberError`, `CannotRemoveLastOwnerError`, the DTOs,
  `ORGANIZATIONS_TYPEORM_ENTITIES`, `ORGANIZATIONS_MIGRATIONS`.
- **Module boundaries:** `libs/organizations` → `@/database` (hard dependency), `@/auth` (direct
  dependency on `AuthorizationService` only, platform-override permission), `@/audit` (direct
  dependency on `AuditService` only, mutation logging) — the same three dependency classes
  `libs/users` already takes. `@/auth` and `@/users` gain no new dependency in either direction.
  `apps/server/src/app.module.ts` needs `ORGANIZATIONS_TYPEORM_ENTITIES`/`ORGANIZATIONS_MIGRATIONS`
  merged into its existing `DatabaseModule.forRoot` call (after `AUTH_MIGRATIONS`, same ordering
  reason `USERS_MIGRATIONS` needed it — the seed migration grants `organizations:manage` to the
  `admin` role) and a new path alias (`@/organizations`) added to `tsconfig.json`/`nest-cli.json`/
  `package.json`'s Jest `moduleNameMapper`, matching every other library.
- **First Improvement Loop should implement exactly this scope** — `Organization`/`Membership`
  entities + `OrganizationService`/`MembershipService` + `assertOrgRole` + the two controllers/DTOs/
  errors above — and no more. Invitations, custom permissions, and the
  `assertOwnerOrPermission`/`assertOrgRole` generalization are explicitly out of scope until their
  own stated trigger (see Open Questions).

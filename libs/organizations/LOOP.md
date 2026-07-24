# Loop 001

**Library:** libs/organizations
**Date:** 2026-07-24

## Goal

Implement `libs/organizations` from scratch per `libs/organizations/ARCH.md` Design 001:
`Organization`/`Membership` CRUD, org-scoped role hierarchy (`owner`/`admin`/`member`), and the
`assertOrgRole` authorization primitive — exactly the scope Design 001's Handoff section named, no
invitations/billing/settings/policy-engine generalization. Greenfield implementation following a
completed Design Mode session, not a refactor.

## Files Reviewed

- `libs/users/src/{domain,application,dto,errors,http,persistence}` and `libs/users/src/index.ts` —
  the flat domain/application/dto/errors/http/persistence layout, `BaseRepository`/
  `@DatabaseRepository`/`@InjectRepository` conventions, `forRoot`/`forRootAsync` module shape
  (mirrored file-for-file for `OrganizationsModule`), migration file/timestamp conventions, and the
  `users:manage` seed-migration pattern this library's `organizations:manage` seed mirrors exactly.
- `libs/auth/src/application/authorization.service.ts` — confirmed `AuthorizationService
  .hasPermission` signature for the platform-override half of `assertOrgRole`.
- `libs/audit/src/application/audit.service.ts` — confirmed `AuditService.record`'s direct-call
  shape (no port/token) already established by `libs/auth`/`libs/users`.
- `libs/database/src/repository/base.repository.ts` — confirmed available repository methods
  (`save`/`findOneBy`/`find`/`count`/`delete`) and that pessimistic-lock helpers require an active
  `@Transactional()` context (not used here — see ARCH.md Key Decisions MEDIUM #1).
- `nest-cli.json`, `tsconfig.json`, `package.json` (Jest `moduleNameMapper`), `apps/server/src/
  app.module.ts` — the existing six-library entity/migration merge into one `DatabaseModule.forRoot`
  call, extended to a seventh.

## Problems Found

N/A — greenfield implementation, not a review of existing code.

## Changes Made

- Scaffolded `libs/organizations` (`nest-cli.json` library entry, `tsconfig.json` `@/organizations`
  path alias, `tsconfig.lib.json`, Jest `moduleNameMapper` entry — no new npm dependencies needed).
- Domain: `OrganizationEntity` (`organizations`) + `OrganizationRepository extends BaseRepository`;
  `MembershipEntity` (`memberships`: real FK to `organizations.id` with `onDelete: 'CASCADE'`,
  `userId` unique-indexed via a composite `(organizationId, userId)` index, not a DB foreign key into
  `libs/users`/`libs/auth` — see ARCH.md Key Decisions MEDIUM #2) + `MembershipRepository extends
  BaseRepository` (`findByOrganizationAndUser`, `findByOrganization`, `countByOrganizationAndRole`);
  `MembershipRole` enum (`owner`/`admin`/`member`).
- Application:
  - `OrganizationService` — `create` (organization + owner membership in one call, not two separable
    steps), `get`/`delete` (both gated by `assertOrgRole`), and `assertOrgRole` itself (the org-scoped
    authorization primitive: role-rank check against a minimum, falling back to the
    `organizations:manage` platform override, otherwise 403 — no existence leak, since a stranger to
    a nonexistent org gets the same 403 as a stranger to a real one). Also exposes
    `hasManageOverride` so `MembershipService`'s owner-only carve-outs can reuse the same override
    check without duplicating the `hasPermission` call.
  - `MembershipService` — `listMembers` (member-level access), `addMember` (admin-level access, plus
    an owner-only carve-out for granting the `owner` role, plus `AlreadyAMemberError` mapped from the
    unique-constraint violation), `changeRole`/`removeMember` (admin-level access; an `admin` can
    never touch an existing `owner`'s membership — enforced as an explicit extra check, not folded
    into the role-rank comparison; `removeMember` also lets a member remove themselves without the
    admin gate; both enforce the "at least one owner remains" aggregate invariant via
    `assertNotLastOwner`, since TypeORM/MySQL can't express that as a schema constraint).
- HTTP: `OrganizationController` (`POST/GET/DELETE /organizations(/:organizationId)`) and
  `MembershipController` (`GET/POST /organizations/:organizationId/members`,
  `PATCH/DELETE .../members/:userId`) — every mutating/reading method derives `actingUserId` from
  `@CurrentUser()`, never from a body/query/path parameter, same closed bug class `libs/users`
  already established.
- DTOs (`CreateOrganizationDto`, `AddMemberDto`, `ChangeMemberRoleDto`) + response DTOs
  (`OrganizationResponseDto`, `MembershipResponseDto`), validated via `class-validator`.
- Errors: `OrganizationNotFoundError`/`MembershipNotFoundError` (404), `ForbiddenOrganizationAccessError`
  (403), `AlreadyAMemberError`/`CannotRemoveLastOwnerError` (409).
- Persistence: `InitialOrganizationsSchema1753700000000` (both tables + the composite unique index)
  and `SeedOrganizationsManagePermission1753710000000` (grants `organizations:manage` to the
  bootstrap `admin` role, same pattern as `SeedUsersManagePermission`) — migration timestamps
  continue the existing sequence directly after `libs/audit`'s `1753600000000`.
- Wired into `apps/server/src/app.module.ts`: `ORGANIZATIONS_TYPEORM_ENTITIES`/
  `ORGANIZATIONS_MIGRATIONS` merged into the existing `DatabaseModule.forRoot` call (after
  `AUTH_MIGRATIONS`, same ordering reason `USERS_MIGRATIONS` needed it), `OrganizationsModule.forRoot()`
  added to the imports list.
- Test coverage: unit tests for both services (33 tests total across 4 spec files) covering —
  `assertOrgRole`'s role-rank/override/rejection paths; `create`'s two-write sequence; `get`/`delete`'s
  403-before-404 ordering; `addMember`'s duplicate-key mapping and owner-only role-grant gate;
  `changeRole`/`removeMember`'s admin-cannot-touch-owner rule and last-owner protection (including the
  self-removal bypass of the admin gate); both controllers' pure-delegation behavior.

## Why

- Two-write `create` left unwrapped in a transaction, consistent with `libs/auth/ARCH.md` Design
  006's finding that no library in this monorepo actually uses `@Transactional()` — flagged in
  ARCH.md as the first concrete candidate to revisit, not silently resolved here.
- `assertOrgRole` and the owner-only carve-outs were kept as plain methods/private helpers, not a
  new pattern/abstraction — per ARCH.md's Rejected Alternatives, this is the *second* differently
  shaped ownership consumer `libs/users/ARCH.md` flagged as worth watching, still short of that
  document's stated bar (a *third*) for building a shared generalization.

## Tests

`npx jest libs/organizations` — 4 suites, 33 tests, all passing. Full monorepo suite
(`npx jest`) — 163 of 168 suites run (5 pre-existing skips, unrelated to this change), 1273 of 1281
tests passing, no new failures.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Live-verify against real MySQL/Redis/RabbitMQ (unit-tested only so far, mirroring how `libs/users`
  Loop 001 preceded its own Loop 002 live-verification pass).
- Consider wrapping `OrganizationService.create`'s two writes in `@Transactional()` — flagged in
  ARCH.md Key Decisions MEDIUM #1 as the first real candidate for it in this monorepo; deferred to
  a follow-up loop rather than introduced speculatively in the same pass as the greenfield build.

## Next Loop

- Live verification (the `libs/users`/`libs/audit` precedent: unit tests first, then a real-infra
  pass in a Loop 002).
- Revisit the `@Transactional()` question for `create` once a decision is made on whether this
  monorepo should adopt it at all (currently zero consumers anywhere, per `libs/auth/ARCH.md` Design
  006).

---

# Loop 002

**Library:** libs/organizations
**Date:** 2026-07-24

## Goal

Close Loop 001's one remaining verification gap: live-verify the full `Organization`/`Membership`
surface end to end against real MySQL/RabbitMQ (Docker was already up this session), mirroring
`libs/users` Loop 002's approach — particularly the role-hierarchy gates, the last-owner invariant,
the admin-cannot-touch-owner rule, self-removal, and the platform-override permission's
live-effective-immediately property.

## Files Reviewed

- Live HTTP walkthrough only — no source changes this loop.

## Problems Found

None. A stale `dist/apps/server/main` process (predating this session's `libs/organizations` code)
was already occupying port 3000, and a second `nest start --watch` process from a prior day was
running but not actually bound to the port — same category of stale-process issue `libs/users` Loop
002 hit. Killed both and started a fresh `npx nest start server`, which picked up the current build
(`OrganizationController`/`MembershipController` routes mapped, `OrganizationRepository`/
`MembershipRepository` registered, migrations ran clean against the already-migrated schema).

## Live verification performed (real MySQL/RabbitMQ)

- Registered three fresh users (owner/admin/stranger roles are test-scenario labels, not RBAC
  roles); bootstrapped email verification via direct SQL, same documented manual/ops step every
  prior loop has used (`libs/auth/ARCH.md` Design 003's login-blocks-on-unverified gate).
- `POST /organizations` as the owner-designate → 201, and `GET .../members` immediately showed a
  single auto-created `owner` membership for that user — confirms `OrganizationService.create`'s
  "organization + owner membership together" behavior (ARCH.md Key Decisions HIGH #2) really holds
  against a real DB write, not just the mocked unit test.
- A stranger (no membership) `GET /organizations/:id` on the real org → **403**; the same stranger
  against a **nonexistent** org id → **403** as well, not 404 — confirms `assertOrgRole`'s
  no-existence-leak ordering holds over real HTTP/DB, the same property `libs/users` Loop 002
  verified for `assertOwnerOrPermission`.
- Owner added a second user as `admin` → 201; that new admin could immediately list members (a
  member-level read) and add a third user as `member` → 201.
- The admin tried to add the third user again → **409** (`AlreadyAMemberError`, the unique
  `(organizationId, userId)` index doing real work against a real duplicate-key error, not a mocked
  one).
- The admin tried to grant `owner` to the third user → **403** — confirms "only an owner may grant
  the owner role" over real HTTP.
- The admin tried to remove the actual owner → **403** — confirms "an admin can never touch an
  owner row," even though the admin passed the base `assertOrgRole(minRole: admin)` gate.
- The (sole) owner tried to remove themselves → **409** (`CannotRemoveLastOwnerError`) — the
  aggregate invariant held against a real single-owner org.
- The owner then promoted the admin to `owner` (two owners now exist), and only *then* successfully
  demoted themselves to `admin` — confirms the last-owner check is evaluated against live DB state at
  the moment of the mutation, not a stale in-memory count.
- The third user (a plain `member`) removed themselves ("leave") with **no** `admin`-role gate
  applied — confirms `removeMember`'s self-removal bypass.
- **The decisive test** (mirroring `libs/users` Loop 002's exact style): granted the bootstrap
  `admin` RBAC role — which the `SeedOrganizationsManagePermission` migration already grants
  `organizations:manage` to — to the original stranger user via direct SQL, then replayed that
  user's *same, already-issued, untouched* access token against `GET /organizations/:id` again →
  200 immediately, with **zero** membership row for that user in the org. Confirms
  `AuthorizationService.hasPermission`'s live read (not a stale JWT claim) is really what
  `hasManageOverride` gates. The same override user then `DELETE`d the organization outright (an
  owner-level action) despite never having been a member.
- Confirmed the FK cascade: after that delete, `SELECT COUNT(*) FROM memberships WHERE
  organizationId = ...` → 0, alongside the organization row itself being gone — the
  `onDelete: 'CASCADE'` declared on `MembershipEntity` works against real MySQL, not just
  better-sqlite3's unit-test dialect.
- Cleaned up all test data (all three users, their refresh/auth tokens, the role grant) after
  verification; the organization/membership rows were already gone via the cascade delete above.

## Why

Same reasoning as `libs/users` Loop 002 and `libs/auth` Loop 007: mocked unit tests can make a
live-permission-check or a foreign-key-cascade assumption look correct without exercising a real
Nest DI boot, a real migrated MySQL schema, or a real HTTP round-trip. The properties this library's
design most depends on — the last-owner invariant evaluated against live state, the admin/owner
role-touch restriction, override permissions taking effect immediately rather than on next login,
and the FK cascade actually deleting memberships — are exactly the kind of thing worth confirming
against the real stack, not just asserting from unit tests with mocked repositories.

## Tests

No new automated tests (live/manual HTTP verification, same category as `libs/users` Loop 002). Full
monorepo suite unaffected by this loop (no source changes).

## Build

PASS (no changes; rebuilt via `npx nest start server` to pick up Loop 001's build before verifying)

## Lint

N/A (no changes)

## Remaining TODO

- Unchanged from Loop 001: whether to wrap `OrganizationService.create`'s two writes in
  `@Transactional()` remains open, tied to a monorepo-wide decision on adopting the decorator at all.

## Next Loop

- No further work queued for `libs/organizations` until a concrete trigger appears (invitations,
  custom per-org permissions, or a third differently-shaped ownership consumer that would justify
  generalizing `assertOwnerOrPermission`/`assertOrgRole` — see ARCH.md Open Questions).

---

# Loop 003

**Library:** libs/organizations
**Date:** 2026-07-24

## Goal

First ordinary review pass (Phase 1–6, `ci.loop` Sections 1–19) now that Loops 001–002 (greenfield
build + live verification) are done — the point in this repo's established rhythm where a freshly
built library gets a review-focused loop next (e.g. `libs/audit` Loop 003, `libs/users` Loop 003).

## Files Reviewed

- `libs/organizations/src/application/{organization.service,membership.service}.ts` and their specs
  — re-read line by line against `ci.loop`'s Structural Review Checklist (Section 19) and
  Security Checklist (Section 13), specifically the no-existence-leak and concurrency/race-condition
  items.
- `libs/organizations/src/domain/membership.repository.ts` — confirmed `countByOrganizationAndRole`
  existed on the repository but had zero callers.

## Problems Found

**Critical**
- `MembershipService.removeMember` looked up the target membership (`findMembershipOrFail`, which
  can throw a 404) *before* checking `assertOrgRole` for the "remove someone else" path. An
  unauthorized caller (not an admin, not even a member of the organization) received a **403** when
  `targetUserId` was a real member but a **404** when it wasn't — leaking "is this user a member of
  this organization" to a caller with no access to the organization at all. This is the exact
  existence-leak class `libs/users`' `getForUser` was deliberately built to avoid (auth-check before
  lookup), and this method simply had the two checks in the wrong order. `changeRole` was already
  correct (`assertOrgRole` ran first); only `removeMember` had the bug.

**Medium**
- `MembershipService.assertNotLastOwner` loaded the organization's entire member roster
  (`findByOrganization`) and filtered it in JS to count owners, on every removal/demotion of an
  owner — while `MembershipRepository.countByOrganizationAndRole` already existed for exactly this
  and was simply never called. Dead-code-adjacent (an unused repository method) plus an unnecessary
  full-table-scan-per-org where a single `COUNT` query does the same job.

**Low**
- None beyond the above.

## Changes Made

- Reordered `removeMember`: `assertOrgRole` (for the "remove someone else" branch) now runs before
  `findMembershipOrFail`, matching `changeRole`'s existing (correct) order.
- Rewrote `assertNotLastOwner` to call `countByOrganizationAndRole(organizationId, OWNER)` and check
  `count <= 1`, instead of loading and filtering the full roster — valid because both call sites only
  reach this method after already confirming the excluded user's row currently has `role === OWNER`,
  so "would this leave zero owners" reduces to "is the current owner count exactly 1." Dropped the
  now-unused `excludingUserId` parameter rather than leaving it as a dead argument.
- Added a regression test (`membership.service.spec.ts`) asserting an unauthorized caller gets 403
  for a nonexistent target without `findByOrganizationAndUser` ever being called — locks in the fix
  so the ordering can't silently regress.
- Updated the three last-owner-related unit tests to mock `countByOrganizationAndRole` instead of
  `findByOrganization`.

## Why

The existence-leak bug is a genuine security-relevant correctness gap: this library's whole
`ARCH.md` Security Architecture section rests on "no existence leak" as a stated property (borrowed
directly from `libs/users`' precedent), so having one real path violate it silently would have been
exactly the kind of drift `ci.loop` Phase 2 exists to catch before a real consumer depends on the
broken ordering. The `countByOrganizationAndRole` fix is a straightforward efficiency/dead-code
cleanup with no behavior change — same semantics, one query instead of a full scan.

## Tests

`npx jest libs/organizations` — 4 suites, 34 tests (33 prior + 1 new regression), all passing. Full
monorepo suite: 163 of 168 suites run (5 pre-existing skips), 1274 of 1282 tests passing, no
regressions.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npx eslint "libs/organizations/**/*.ts"`)

## Remaining TODO

- Noted but not fixed this loop: `assertNotLastOwner`'s count check (and the last-owner invariant
  generally) is a check-then-act race under true concurrency — two simultaneous
  `removeMember`/`changeRole` calls against two *different* owners of a two-owner organization could
  each read `count = 2` before either write commits, leaving zero owners. Fixing this properly would
  need either `@Transactional()` + a pessimistic lock (unproven in this monorepo — `libs/auth/ARCH.md`
  Design 006 recorded that no library here has ever gotten `@Transactional()` working end to end, and
  `better-sqlite3`, which every integration test in this repo depends on, can't execute
  `SELECT ... FOR UPDATE` at all) or an atomic conditional-update query. Left as an accepted,
  documented risk — same category as `libs/auth`'s RBAC races, which were fixed via single-row atomic
  writes rather than transactions specifically *because* multi-row invariants like this one don't
  reduce to a single atomic statement. Recorded in `ARCH.md` rather than silently left implicit.
  Revisit if concurrent-owner-management ever becomes a realistic scenario (this platform's stated
  scale/team context — single maintainer — makes it a low-probability edge case today).
- Unchanged from Loop 001: whether to wrap `OrganizationService.create`'s two writes in
  `@Transactional()` remains open.

## Next Loop

- No further work queued until a concrete trigger appears (see Loop 002's Next Loop note, unchanged).

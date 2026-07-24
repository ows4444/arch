# Loop 001

**Library:** libs/users
**Date:** 2026-07-23

## Goal

Implement `libs/users` from scratch per `libs/users/ARCH.md` Design 001: `UserProfile` CRUD
(`getOrCreate`, `updateMine`, `getForUser`) plus the ownership-check consumer
(`assertOwnerOrPermission`) that resolves `libs/auth`'s deferred resource-level authorization item.
Greenfield implementation following a completed Design Mode session, not a refactor.

## Files Reviewed

- `libs/auth/src/{domain,application,http,guards,decorators,persistence}` — the flat
  domain/application/dto/errors/http/persistence layout, `BaseRepository`/`@DatabaseRepository`/
  `@InjectRepository` conventions, `forRoot`/`forRootAsync` module shape, migration file/timestamp
  conventions, and the `roles:manage` seed-migration pattern this library's `users:manage` seed
  mirrors.
- `libs/database/src/repository/{base.repository,repository.providers,repository.registry}.ts` —
  confirmed `@DatabaseRepository`-decorated repositories need no explicit provider registration in
  the owning module (the decorator populates a process-global registry as an import-time side
  effect; `DatabaseCoreModule` — `@Global()` — creates providers for every registered class), so
  `UsersModule` doesn't need a `RepositoryProviderFactory` call, matching how `AuthModule` never has
  one either.
- `apps/server/src/app.module.ts` — the existing five-library entity/migration merge into one
  `DatabaseModule.forRoot` call, extended to a sixth.

## Problems Found

N/A — greenfield implementation, not a review of existing code.

## Changes Made

- Scaffolded `libs/users` (`nest-cli.json` library entry, `tsconfig.json` `@/users` path alias,
  `tsconfig.lib.json`, jest `moduleNameMapper` entry — no new npm dependencies needed).
- Domain: `UserProfileEntity` (`user_profiles`: `userId` unique-indexed, not a DB foreign key into
  `auth_users` — see ARCH.md Key Decisions MEDIUM #1) + `UserProfileRepository extends
  BaseRepository`.
- Application: `UserProfileService` —
  - `getOrCreateMine(userId)`: lazy creation on first access (no `libs/auth` registration-time
    orchestration — ARCH.md Key Decisions HIGH #1). Handles the create-race case (two concurrent
    first-accesses) by catching the duplicate-key error and re-reading, the same pattern
    `libs/auth`'s `UserRepository.addRole` uses for its own join-table race.
  - `updateMine(userId, patch)`: `getOrCreateMine` then merge-and-save.
  - `getForUser(targetUserId, actingUserId)` + private `assertOwnerOrPermission`: the concrete,
    two-branch ownership check (owner-equality, or `AuthorizationService.hasPermission` override)
    that resolves the `REQUIREMENTS.md` Tier 1 authorization item — see ARCH.md Key Decisions
    HIGH #3. **Implementation refinement vs. ARCH.md's sketch:** checks the permission *before*
    fetching the profile (ARCH.md sketched `assertOwnerOrPermission(profile, ...)`, fetch-then-
    check), so an unauthorized caller gets the same 403 whether or not a profile exists for
    `targetUserId` — never leaking existence to someone not entitled to see it. Noted here since
    it's a real signature change from the design sketch, not a silent deviation.
  - `UserProfileService` takes `AuthorizationService` as a direct constructor dependency (from
    `@/auth`) — matches ARCD.md Key Decisions MEDIUM #2 (not a port; `AuthorizationService` is a
    stable shared service, not a swappable cross-cutting concern).
- HTTP: `UserProfileController` — `GET/PATCH /users/me` (target always derived from the verified
  JWT via `@CurrentUser()`, never from a client-supplied id — closes the "edit someone else's
  profile via a spoofed body id" class of bug), `GET /users/:userId` (owner or `users:manage`).
  Guarded by `JwtAuthGuard` only — `PermissionsGuard`'s route-level `@Permissions()` metadata isn't
  used here since the permission check is data-dependent (depends on whether `:userId` equals the
  caller), not a fixed per-route requirement, so it lives inside the service instead.
- DTOs: `UpdateProfileDto` (all fields optional, length-bounded, matching `libs/auth`'s DTO
  conventions), `UserProfileResponseDto`.
- Errors: `UserProfileNotFoundError` (404), `ForbiddenProfileAccessError` (403).
- Persistence: `1753500000000-InitialUsersSchema` migration (`user_profiles` table) +
  `1753510000000-SeedUsersManagePermission` (seeds `users:manage`, grants it to the `admin` role
  `libs/auth`'s own seed migration already created — must run after `AUTH_MIGRATIONS`, enforced by
  ordering in `apps/server/src/app.module.ts`, documented in the migration's own doc comment).
- `UsersModule.forRoot`/`forRootAsync` (`@Global()`, empty static `@Module({})` decorator per the
  NestJS dynamic-module/decorator-merge convention already established across every sibling lib).
  Simpler than `AuthModule`'s `AuthConfigModule` split: `USERS_MODULE_OPTIONS` is only consumed by
  `UserProfileService`, a provider of `UsersModule` itself, not by a nested imported dynamic module
  — so the parent-can't-inject-into-child-import limitation `AuthModule`'s Loop 007 hit doesn't
  apply here.
- Wired into `apps/server/src/app.module.ts`: `USERS_TYPEORM_ENTITIES`/`USERS_MIGRATIONS` merged
  into the existing `DatabaseModule.forRoot` call (migrations ordered after `AUTH_MIGRATIONS`);
  `UsersModule.forRoot()` registered after `AuthModule.forRootAsync`.
- 15 unit tests: `user-profile.service.spec.ts` (10 — create/race/rethrow, update, ownership/
  permission/not-found/override), `user-profile.controller.spec.ts` (3 — pure delegation),
  `1753500000000-InitialUsersSchema.migration.spec.ts` (2 — table round-trip via real sqlite entity
  mapping; seed-migration grant verified against auth's real migrated schema, confirming `admin`
  ends up holding both `roles:manage` and `users:manage`).

## Why

See `libs/users/ARCH.md` Design 001 for the full rationale (separate `UserProfile` aggregate from
`libs/auth`'s `User`, lazy creation over registration-time orchestration, plain unique-indexed
`userId` over a cross-lib foreign key, the ownership-check resolving the deferred authorization
item as two branches instead of a policy engine).

## Tests

15 new tests in `libs/users` (3 spec files), all passing. Full monorepo suite: 152 suites (4
skipped by default, unchanged) / 1212 passing (5 skipped, unchanged) — no regressions.

## Build

PASS (`npm run typecheck`; `npx nest build server` — webpack compiled successfully)

## Lint

PASS (`npm run lint`, one real fix applied — an `Object.create(...)`-constructed mock error in
`user-profile.service.spec.ts` triggered `no-unsafe-assignment`/`no-unsafe-member-access`; rewritten
via a typed `Object.assign` instead of loosening the rule)

## Remaining TODO

- No endpoint/service method to list all profiles (admin-facing "list users") — out of scope per
  ARCH.md's stated initial scope; add only if a concrete need appears.
- Organization Management (`REQUIREMENTS.md` Tier 2's second item) remains the next Design Mode
  session, per ARCH.md's Open Questions.

## Next Loop

- None forced. `libs/users` has now been verified at every level this protocol distinguishes: unit
  (mocked), integration (sqlite, real migration/entity round-trip), and live (real MySQL/Redis/
  RabbitMQ, real HTTP — see below). Next work should come from a concrete new requirement.

---

# Loop 002

**Library:** libs/users
**Date:** 2026-07-23

## Goal

Close Loop 001's one remaining verification gap: live-verify `GET/PATCH /users/me` and
`GET /users/:userId` end to end against real MySQL/Redis/RabbitMQ (Docker was already up this
session), mirroring `libs/auth` Loop 007's approach — particularly the ownership-vs-permission
branch and the 403-before-404 (no-existence-leak) ordering on `getForUser`.

## Files Reviewed

- Live HTTP walkthrough only — no source changes this loop.

## Problems Found

None. A stale `dist/apps/server/main` process was already occupying port 3000 from before this
session's code changes (predated the new `/users/*` routes — confirmed via `GET /users/me`
returning `Cannot GET /users/me` against it). Not a defect in this library; stopped it and
rebuilt/restarted (`npx nest start server`) to pick up the current build before verifying.

## Live verification performed (real MySQL/Redis/RabbitMQ)

- Registered two fresh users; `POST /auth/register`'s existing login-blocks-on-unverified-email
  gate (`libs/auth/ARCH.md` Design 003) required bootstrapping verification the same documented
  manual/ops way `libs/auth` Loop 008 bootstrapped its first admin (direct SQL), not a `libs/users`
  concern.
- `GET /users/me` (user1, no prior row) → 200, lazy-created a blank-`displayName` profile.
  Repeated the same call → identical row (same `id`/`createdAt`), confirming `getOrCreateMine`
  doesn't create a duplicate on a second access.
- `PATCH /users/me` (user1: `displayName`, `bio`) → 200, changes persisted and reflected on
  re-read.
- `GET /users/me` with no `Authorization` header → 401 (`JwtAuthGuard`, unchanged from `libs/auth`).
- `GET /users/:user1Id` as user2 (no role) → 403 (`ForbiddenProfileAccessError`) — ownership gate
  correctly rejects a stranger.
- Granted user2 the existing `admin` role (holds `users:manage`, seeded by
  `SeedUsersManagePermission`) via direct SQL — **the decisive test**: replayed user2's *same,
  already-issued, untouched* access token against `GET /users/:user1Id` again → 200, immediately.
  Confirms the live `AuthorizationService.hasPermission` read (not a stale JWT claim) actually
  gates this route, the same "effective immediately" property `libs/auth` Loop 008 verified for its
  own RBAC routes.
- Revoked the role, then requested a profile for a **non-existent** random uuid as the
  now-unprivileged user2 → 403 (not 404) — confirms `assertOwnerOrPermission` really does run
  before the profile lookup, so an unauthorized caller can't distinguish "exists but forbidden"
  from "doesn't exist" (see Loop 001's noted refinement over ARCH.md's sketch).
- Cleaned up all test data (both users, their profiles, refresh tokens, role grant) after
  verification.

## Why

Same reasoning as `libs/auth` Loop 007: mocked/sqlite tests can make a live-permission-check
assumption look correct without exercising a real Nest DI boot, a real migrated MySQL schema, or a
real HTTP round-trip. The two properties this library's design most depends on —
"ownership/permission changes take effect immediately, not on next login" and "unauthorized access
doesn't leak whether the target profile exists" — are exactly the kind of thing worth confirming
against the real stack, not just asserting from unit tests.

## Tests

No new automated tests (live/manual HTTP verification, same category as `libs/auth` Loop 007). Full
monorepo suite unaffected by this loop (no source changes).

## Build

PASS (no changes; rebuilt via `npx nest build server` as part of restarting the dev server)

## Lint

N/A (no changes)

## Remaining TODO

- Unchanged from Loop 001: no admin-facing "list all profiles" endpoint; Organization Management
  remains the next Design Mode session.

## Next Loop

- None forced. Next work should come from a concrete new requirement (most likely: Organization
  Management's Design Mode session, once there's a real need to attach membership to
  `UserProfile`).

---

# Loop 003

**Library:** libs/users
**Date:** 2026-07-23

## Goal

Wire `UserProfileService.updateMine` into the new `libs/audit` Audit Module (`libs/audit/ARCH.md`
Design 001; `libs/audit/LOOP.md` Loop 001).

## Files Reviewed

- `application/user-profile.service.ts` — `updateMine` already receives the acting user's `userId`
  as its first parameter (self-only), so no signature change was needed here, unlike `libs/auth`'s
  RBAC methods.

## Problems Found

N/A — feature addition, not a review pass.

## Changes Made

- `UserProfileService` constructor-injects `AuditService` (`@/audit`); `updateMine` now records a
  `profile.updated` entry (`actorId`/`targetId` both the same `userId`, `metadata.fields` the
  patch's changed keys) after the save succeeds.
- Updated `user-profile.service.spec.ts` (audit mock + assertion on the existing `updateMine` test).
- Documented as `libs/users/ARCH.md` Design 002 (new `@/audit` dependency).

## Why

See `libs/audit/ARCH.md` Design 001 for the full cross-lib rationale (this was the second of the
two confirmed initial consumers, alongside `libs/auth`'s RBAC methods).

## Tests

`libs/users` suite: unchanged test-file count, 1 existing test extended with an audit assertion.
Full monorepo suite: 154 suites / 1216 tests passing (see `libs/audit/LOOP.md` Loop 001 for the
combined count).

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Unchanged from Loop 002.

## Next Loop

- None forced. Next work should come from a concrete new requirement.

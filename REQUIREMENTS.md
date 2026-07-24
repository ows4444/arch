# Requirements Doc — Platform Roadmap

> Reference document for future development. Captures what's built, what's partial, what's planned, and why — so priority calls don't need to be re-derived every session. Reviewed against `ci.loop`'s Design Mode discipline (Section 0): nothing here is scoped to microservices/CQRS/event-sourcing/multi-tenant unless explicitly justified.

**Last updated:** 2026-07-24
**Status:** Living document — append/update, don't silently replace. Update the coverage table whenever a library/app changes; add a dated note under "Decision Log" when a prioritization call changes.

---

## 1. Current State — Coverage Map

The platform is **infrastructure-first**: seven mature shared libraries and two thin apps, with almost no domain/business modules built yet.

### Done

| Module | Where | Notes |
|---|---|---|
| Cache | `libs/cache` | memory/redis/multi-level backends, `@Cacheable`/`@CachePut`/`@CacheEvict`, single-flight dedup |
| Database access | `libs/database` | reader/writer datasource split, `@Transactional`, migrations, pagination, optimistic/pessimistic locking |
| Queue / messaging | `libs/queue` | topology-as-code, transactional outbox + inbox, retry/dead-letter semantics |
| Workflow / saga engine | `libs/workflow` | durable state machine, compensation, retry, distributed leases, child workflows |
| Validation | `libs/validation` | class-validator rule composition, persisted rule storage |

### Partial

| Module | Where | Missing |
|---|---|---|
| Authentication | `libs/auth` | login/logout, refresh tokens, JWT, forgot/reset password, email verification, change-password, and device management (list/revoke own active sessions, `LOOP.md` Loop 022, 2026-07-24) are done. Missing: MFA/2FA, API keys, OAuth2, SSO |
| Authorization | `libs/auth/application/authorization.service.ts` | RBAC only. Missing: policy engine, resource-level/ownership checks, dynamic permissions |
| Rate limiting | `libs/ratelimit` | limiting itself is done. Missing: API versioning, API docs, API analytics — the rest of a full API-management layer |
| Health/monitoring | `apps/server/src/health` | liveness/readiness only. Missing: metrics, service-status aggregation, dependency health beyond the basics |
| Request context | `apps/server/src/request-context` | request ID middleware + propagation into structured (JSON) logs done. Missing: trace/span propagation (no APM backend chosen yet) |
| User Management | `libs/users` | `libs/users/ARCH.md` Design 001 + `LOOP.md` Loops 001–002 (2026-07-23): `UserProfile` CRUD (`getOrCreate`/`updateMine`/`getForUser`) and the ownership-check authorization consumer (`assertOwnerOrPermission`) implemented, tested at every level (unit, sqlite integration, live HTTP against real MySQL/Redis/RabbitMQ), wired into `apps/server`. Missing: admin-facing "list all profiles" (add only if a concrete need appears) |
| Audit | `libs/audit` | `libs/audit/ARCH.md` Design 001–002 + `LOOP.md` Loops 001–002 (2026-07-23/24): append-only `AuditEntry` + `AuditService.record(...)`, wired as a direct call from `libs/auth`'s 8 RBAC mutation methods, `libs/users`' `updateMine`, and (as of 2026-07-24) `libs/organizations`' `OrganizationService`/`MembershipService` — its third consumer, confirmed to still fit the direct-dependency-per-consumer pattern rather than warranting a decorator/enhancer (Design 002). Wired into `apps/server`, live-verified against real MySQL (all 9 original audited actions confirmed; also caught and fixed a real bug in `profile.updated`'s metadata — see `libs/audit/LOOP.md` Loop 002). Missing: an HTTP read endpoint (deferred until a concrete need to view audit history appears) |
| Notification Service | `libs/notification` | `libs/notification/ARCH.md`/`LOOP.md` Loop 001 (2026-07-23): generic `NotificationService` + pluggable `EMAIL_SENDER` port (no-op default, `LoggingEmailSender` wired in both apps), wired as `libs/auth`'s first-ever real `AuthEventPublisher` (`apps/server`'s `QueueAuthEventPublisher`, for `PasswordResetRequestedEvent`/`EmailVerificationRequestedEvent` only) → outbox → RabbitMQ → `apps/worker`'s new `EmailNotificationConsumer` — live-verified end to end against real MySQL/RabbitMQ. Missing: SMS/push/in-app channels, a real SMTP/SendGrid/SES adapter, and wiring the other four auth events (all deferred until a concrete trigger appears) |
| Organization Management | `libs/organizations` | `libs/organizations/ARCH.md` Design 001 + `LOOP.md` Loops 001–002 (2026-07-24): `Organization`/`Membership` CRUD, org-scoped role hierarchy (`owner`/`admin`/`member`), and `assertOrgRole` (role-rank check + `organizations:manage` platform override) implemented, unit-tested (33 tests), and live-verified end to end against real MySQL/RabbitMQ (auto-owner-membership on create, 403-before-404 no-existence-leak, admin-cannot-touch-owner, last-owner invariant against live state, self-removal, the platform override taking effect on an already-issued token with zero membership, and the FK cascade delete). Missing: invitations, custom per-org permissions, and the `assertOwnerOrPermission`/`assertOrgRole` generalization are explicitly deferred (see ARCH.md Open Questions) |
| Scheduler Module | `libs/scheduler` | `libs/scheduler/ARCH.md` Design 001 + `LOOP.md` Loops 001–004 (2026-07-24): `@ScheduledJob` decorator-based recurring-job registration (discovered at boot like `@RMQConsumer`), firing exactly once across replicas via the same claim-batch DB idiom `libs/queue`'s outbox/`libs/workflow`'s `WorkflowSchedule` use, implemented and unit-tested (28 tests) plus live-verified end to end against real MySQL/RabbitMQ. A Critical boot-crash bug (DB access in `OnModuleInit` racing the datasource connection) was caught and fixed during live verification (Loop 001); a Medium orphaned-row hot-loop bug was caught and fixed in the follow-up review pass (Loop 002). Now has its first real consumer (`libs/auth`'s `auth.refresh-token-purge`, Loop 003/`libs/auth` Loop 024) — which surfaced a Critical bug in `computeNextFireAt`: an omitted `timezone` silently defaulted to the host process's local system timezone, not UTC. Fixed at the process level (`TZ=UTC`) as an immediate mitigation, then closed properly at the library level in Loop 004: `@ScheduledJob` now defaults an omitted `timezone` to `'UTC'` itself, live-verified to produce a correct `nextFireAt` with no process-level env dependency. Missing: a runtime admin API and failure alerting are explicitly deferred (see ARCH.md Open Questions) |

### Not started

| Module | Notes |
|---|---|
| Configuration Module (runtime app/feature-flag settings) | — |
| File Service (upload/storage/signed URLs) | — |
| Search Module | — |
| Reporting Module | — |
| Integration Module (webhooks, third-party clients) | — |
| Compliance Module (data retention, PII, consent) | — |
| DevOps Module (deployment/build info, maintenance mode) | — |
| Background Services beyond queue consumers | `apps/worker` now has one real consumer (`EmailNotificationConsumer`, 2026-07-23) alongside its smoke-test scaffolding |
| Analytics Module | — |
| AI Module | optional/no current use case |
| Observability (tracing, metrics export) | — |

`apps/`: `server` (health, request-context, redis wiring, validation-rules, `libs/auth`'s real event publisher) and `worker` (smoke-test scaffolding + the real `EmailNotificationConsumer`) — neither has domain HTTP endpoints of its own yet.

---

## 2. Roadmap — Prioritized, Risk-Tagged

Risk scale per `ci.loop` §18: LOW / MEDIUM / HIGH / CRITICAL.

### Tier 1 — Complete existing infra before adding new domains

| Item | Risk | Why this order |
|---|---|---|
| Auth completeness: MFA, API keys, OAuth2/SSO (forgot/reset password and device management done, 2026-07-23/24) | HIGH (auth surface) | `libs/auth` already exists; this closes a correctness gap rather than opening a new bounded context |
| Authorization: policy engine, resource-level/ownership checks | HIGH | Every future domain module (Users, Compliance, ...) will need scoped checks, not just role checks |
| Audit Module | MEDIUM | Hooks into existing `libs/database` repositories/transactions; no new architecture required |
| Structured Logging / Observability | MEDIUM | Logs → structured JSON done (2026-07-23, `apps/server/LOOP.md` Loop 005). Remaining: metrics export, trace/span propagation (needs an APM backend choice) |

### Tier 2 — First real domain library

| Item | Risk | Why this order |
|---|---|---|
| User Management | HIGH | This is the platform's actual Core Domain and the first non-infra library — **run `ci.loop` Section 0 (Design Mode) before implementation** to fix the aggregate boundary and its relationship to `libs/auth`, since every later domain module depends on it |
| Organization Management | MEDIUM | Implemented (2026-07-24, see coverage table) per `libs/organizations/ARCH.md` Design 001, scoped against User Management's output rather than in isolation |

### Tier 3 — Justified infra additions (cheap given existing primitives)

| Item | Risk | Why |
|---|---|---|
| Scheduler Module | LOW/MEDIUM | Implemented (2026-07-24, see coverage table) per `libs/scheduler/ARCH.md` Design 001 — a new, separate library reusing `libs/workflow`'s proven claim-batch scheduling idiom rather than extending `libs/workflow` itself |
| Notification Service | MEDIUM | Natural consumer of `libs/queue` outbox → publish → `apps/worker`, which already exists but is empty |
| File Service | MEDIUM | Only once there's an actual near-term need for uploads; no storage adapter exists yet |

### Deferred / Rejected (justify-or-reject, per `ci.loop` §0.1)

| Item | Reason |
|---|---|
| Search Module | Elasticsearch/OpenSearch is real infra cost; nothing today needs full-text search |
| AI Module | No concrete use case in the platform today |
| Analytics / Reporting | Depend on User/Org/Audit existing first; premature |
| Compliance Module | Depends on User/Org existing; premature |
| Any multi-tenant framing | Platform is single-tenant; don't let Compliance/DevOps work pull in tenant-isolation complexity uninvited |

---

## 3. Process Notes

- Before starting **User Management** or any other first-of-its-kind domain library, run `ci.loop` Section 0 (Design Mode) and record the result in a new `libs/<name>/ARCH.md` — this is the first non-infrastructure bounded context in the platform, so its boundary decisions set precedent for everything downstream (Org, Audit, Notification, Compliance).
- Once a library exists, ordinary work on it follows the `ci.loop` Improvement Loop (Sections 1–19), with completed passes logged in that library's `LOOP.md`.
- Update the coverage tables in Section 1 whenever a `libs/*` or `apps/*` module changes status — this doc should stay accurate without needing to be regenerated from scratch.

## 4. Decision Log

- **2026-07-23** — Initial doc created from a full audit of `apps/*` and `libs/*`. Tiering and reject list as above.
- **2026-07-23** — Started Tier 1's Structured Logging item: `RequestContextLogger` moved from a
  plain-text `[requestId]` prefix to Nest's built-in structured-JSON logging mode with
  `requestId` merged into every log object (`apps/server/LOOP.md` Loop 005). Metrics export and
  trace/span propagation remain open — deferred until an APM backend is chosen.
- **2026-07-23** — Deprioritized Tier 1's Authorization item (policy engine, resource-level/
  ownership checks) relative to starting Tier 2 (User Management) early: `libs/auth/ARCH.md`
  explicitly deferred the policy-engine work until a concrete owned resource exists to design it
  against, and no such resource existed anywhere in the codebase (every prior aggregate is
  auth-internal). Ran `ci.loop` Section 0 (Design Mode) for User Management instead —
  `libs/users/ARCH.md` Design 001 resolves the aggregate boundary against `libs/auth` and resolves
  the deferred authorization item as a concrete two-branch ownership check
  (`assertOwnerOrPermission`) rather than a generic policy engine.
- **2026-07-23** — Implemented User Management (`libs/users` Loops 001–002): `UserProfile` CRUD +
  `assertOwnerOrPermission` per `libs/users/ARCH.md` Design 001's handoff scope, wired into
  `apps/server`, then live-verified end to end against real MySQL/Redis/RabbitMQ (lazy-create,
  ownership 403, live permission-grant taking effect on an already-issued token, and the
  403-before-404 no-existence-leak ordering all confirmed). Moves User Management from
  "Not started" to "Partial" — only admin-facing listing remains open; Organization Management is
  the next Design Mode session once a concrete need to attach membership to `UserProfile` exists.
- **2026-07-23** — Implemented Tier 1's Audit Module (`libs/audit` Loop 001): append-only
  `AuditEntry` + `AuditService.record(...)`, confirmed with the user as a direct-service-call
  mechanism (not a new decorator/enhancer) scoped to RBAC + profile mutations (not every write in
  every lib). Wired into `libs/auth`'s 8 `AuthorizationService` mutation methods (each gained an
  optional trailing `actorId?` parameter) and `libs/users`' `updateMine`, and into `apps/server`.
  Deliberately no HTTP read endpoint yet — would create a `libs/auth`↔`libs/audit` cycle via
  `libs/auth`'s guards; deferred to `apps/server` if a concrete need to view audit history appears.
  Moves the Audit Module from "Not started" to "Partial".
- **2026-07-23** — Live-verified the Audit Module (`libs/audit` Loop 002) against real MySQL: all 9
  audited actions (8 RBAC mutations + profile update) produced correct `audit_entries` rows. Found
  and fixed a real bug along the way — `UserProfileService.updateMine`'s `metadata.fields` recorded
  every possible `UpdateProfileDto` field, not just the ones actually sent, because a real DTO
  instance has every declared field present (as `undefined`) regardless of what the caller sent;
  no unit test had caught it since the existing test used a plain object literal instead of a real
  DTO shape.
- **2026-07-23** — Implemented Tier 3's Notification Service (`libs/notification` Loop 001), scoped
  via two confirmed decisions: email-only for v1 (the only channel with a concrete trigger —
  `libs/auth`'s password-reset/email-verification events already carry a raw token with nowhere to
  go) and `apps/worker` owns the real send (a generic `NotificationService`/`EMAIL_SENDER` port in
  the lib, no domain-specific event knowledge). `apps/server`'s new `QueueAuthEventPublisher` is
  `libs/auth`'s first-ever real `AuthEventPublisher` — composes the reset/verification email
  wording and publishes via the outbox; `apps/worker`'s new `EmailNotificationConsumer` receives it
  and calls `NotificationService.sendEmail`. Live-verified end to end against real MySQL/RabbitMQ
  (both apps booted together for the first time this session; outbox rows confirmed `published`).
  Moves the Notification Service from "Not started" to "Partial" and gives `apps/worker` its first
  real functionality beyond smoke-test scaffolding.
- **2026-07-23** (retroactive correction) — This doc's Tier 1 "Auth completeness" row and
  Authentication coverage entry had drifted stale: forgot/reset password and email verification
  (`libs/auth` Loop 020, same date as this doc's creation) were already implemented before this
  doc's first version was written, but weren't reflected. Corrected in the same edit as the
  2026-07-24 entry below rather than as a separate pass.
- **2026-07-24** — Closed Tier 1's device-management gap (`libs/auth` Loop 022): `deviceId` on
  refresh tokens (Loop 020) was write-only until now — `GET /auth/sessions` /
  `DELETE /auth/sessions/:id` let a user list and revoke their own active sessions, self-service
  only (no admin "manage another user's sessions" surface, since no concrete need for one exists).
  Auth completeness now only has MFA/2FA, API keys, and OAuth2/SSO open — none with a concrete
  trigger yet.
- **2026-07-24** — Considered restarting Tier 1's Authorization item (policy engine) on the theory
  that `libs/users`/`libs/audit` now supply concrete owned resources. Reviewed `libs/users/ARCH.md`
  Design 001's own stated trigger first and found it hasn't fired: generalizing
  `assertOwnerOrPermission` requires a *second, structurally different* ownership shape to appear,
  and none had yet. Deferred that item again, unchanged, and ran `ci.loop` Section 0 (Design Mode)
  for **Organization Management** instead — the item `libs/users/ARCH.md` explicitly named as "the
  next Design Mode session" once `UserProfile` existed, which it now does. `libs/organizations/
  ARCH.md` Design 001 scopes v1 to Organization + Membership only (no invitations/billing/settings)
  with org-scoped roles (owner/admin/member) kept independent of `libs/auth`'s global RBAC — both
  confirmed directly with the user as HIGH-risk calls before designing. That design also surfaces
  `Membership`'s owner/admin/member role check as the *second* differently-shaped ownership
  consumer `libs/users/ARCH.md` was watching for (still short of the *third* that document's own bar
  requires before generalizing into a shared helper). Moves Organization Management from
  "Not started" toward implementation-ready; no code written yet — this entry is the design handoff,
  next step is the first Improvement Loop per `libs/organizations/ARCH.md`'s Handoff section.
- **2026-07-24** — Ran the first Improvement Loop for Organization Management (`libs/organizations`
  Loop 001): implemented exactly the scope `libs/organizations/ARCH.md` Design 001 handed off —
  `Organization`/`Membership` entities, `OrganizationService`/`MembershipService`, `assertOrgRole`,
  both controllers, DTOs/errors, and the two migrations (`InitialOrganizationsSchema`,
  `SeedOrganizationsManagePermission`) — and wired it into `apps/server` (new `@/organizations` path
  alias, entities/migrations merged into the existing `DatabaseModule.forRoot` call after
  `AUTH_MIGRATIONS`). 33 unit tests across both services and both controllers; full monorepo suite
  (1273/1281 tests, 5 pre-existing skips), `typecheck`, and `lint` all pass with no regressions.
  Moves Organization Management from "Not started" to "Partial" — live verification against real
  MySQL/Redis/RabbitMQ remains open, plus the transaction-wrapping question for
  `OrganizationService.create` ARCH.md's Key Decisions MEDIUM #1 flagged (deferred to a follow-up
  loop, not resolved speculatively in the same pass as the greenfield build).
- **2026-07-24** — Live-verified Organization Management (`libs/organizations` Loop 002) against
  real MySQL/RabbitMQ: `create`'s auto-owner-membership, the 403-before-404 no-existence-leak
  ordering, admin-cannot-touch-owner, the last-owner invariant evaluated against live state (not a
  stale count), self-removal bypassing the admin gate, the `organizations:manage` platform override
  taking effect on an *already-issued* token with zero membership rows (the same "decisive test"
  style `libs/users` Loop 002 used), and the `memberships` FK cascade delete — all confirmed working
  end to end. No source changes this loop (verification only); all test data cleaned up afterward.
  Organization Management's only remaining open items are the ones ARCH.md already scoped out
  (invitations, custom per-org permissions, the ownership-check generalization) — none with a
  concrete trigger yet.
- **2026-07-24** — Ran `ci.loop` Section 0 (Design Mode) for Tier 3's **Scheduler Module**
  (`libs/scheduler`), the one remaining roadmap item classified as already-justified rather than
  trigger-gated. A research pass first found that `libs/workflow` already has a complete
  cron-scheduling feature (`WorkflowSchedule`/`WorkflowSchedulerService`, a DB-driven,
  runtime-editable API for cron-triggered *workflow starts*, using the same claim-batch DB idiom as
  the outbox). Confirmed two scope decisions directly with the user before designing: (1)
  `libs/scheduler` is a new, separate library for plain recurring jobs — not an extension of
  `libs/workflow` and not a thin front-end that auto-generates workflows under the hood — since
  forcing trivial periodic jobs through full workflow-engine ceremony (state persistence, unused
  compensation slots) would be disproportionate; (2) jobs are registered via a
  `@ScheduledJob(name, cronExpression, options)` decorator discovered at boot (mirroring
  `@RMQConsumer`'s `DiscoveryModule` pattern), not a runtime-editable database-backed admin API —
  code is the source of truth, the database holds only cross-replica claim state.
  `libs/scheduler/ARCH.md` Design 001 reuses `WorkflowSchedule`'s exact claim-batch idiom and
  `'skip' | 'fire-once'` misfire vocabulary (Section 17: prefer existing patterns), and the `cron`
  package's `CronTime` for schedule math (already a transitive dependency, no new one added). Moves
  Scheduler Module from "Not started" toward implementation-ready; no code written yet — next step
  is the first Improvement Loop per `libs/scheduler/ARCH.md`'s Handoff section.
- **2026-07-24** — Ran the first Improvement Loop for the Scheduler Module (`libs/scheduler`
  Loop 001): implemented exactly the scope `libs/scheduler/ARCH.md` Design 001 handed off —
  `ScheduledJobEntity`, `@ScheduledJob` decorator, `ScheduledJobRegistry` (discovery + DB upsert),
  `ScheduledJobSweepService` (claim + invoke + misfire handling), and the one migration — wired into
  `apps/server` (new `@/scheduler` path alias, entities/migrations merged into the existing
  `DatabaseModule.forRoot` call). 28 tests across 4 spec files (including a real sqlite-backed
  integration test of the claim-batch query), full monorepo suite (1302/1310, 5 pre-existing skips),
  `typecheck`, and `lint` all pass. Live-verified end to end against real MySQL/RabbitMQ with a
  throwaway `@ScheduledJob` provider — in the process, **found and fixed a Critical bug**:
  `ScheduledJobRegistry`'s DB sync ran in `OnModuleInit`, which fires before `libs/database`'s own
  `RepositoryDiscoveryService` (which actually connects the datasource, confirmed to use
  `OnApplicationBootstrap` instead) has run, crashing the entire process at boot on any real
  registered job. Fixed by switching to `OnApplicationBootstrap`, re-verified with 7 consecutive
  clean fires. No real `@ScheduledJob` consumer exists anywhere in `apps/server`/`apps/worker` yet —
  expected, per Tier 3's "justified infra ahead of a concrete need" framing. Moves the Scheduler
  Module from "Not started" to "Partial."
- **2026-07-24** — Ran an open-ended documentation-vs-code drift audit (no remaining `libs/*`
  Improvement Loop work was available — every library had independently hit its own stop condition,
  and no roadmap trigger had fired) across `REQUIREMENTS.md`, every library's `ARCH.md`, and the
  actual code. Found one real drift: `libs/organizations`' `OrganizationService`/`MembershipService`
  became `libs/audit`'s third `AuditService` consumer during that library's Loop 001
  (2026-07-24) — exactly the trigger `libs/audit/ARCH.md` Design 001 named as the point to revisit
  its direct-dependency-per-consumer pattern, but neither this doc nor `libs/audit/ARCH.md` had been
  updated to reflect it (`libs/organizations/ARCH.md` itself was already correct). Closed via
  `libs/audit/ARCH.md` Design 002: evaluated the trigger per its own stated criterion ("pattern
  starts feeling repetitive," not "a third consumer exists at all") and kept the existing pattern —
  three consumers of a one-line `.record(...)` call don't yet warrant a decorator/enhancer mechanism.
  Everything else checked (coverage-table "Missing" claims, migration-ordering comments, ARCH.md
  public-API listings, leftover smoke-test files) matched reality with no drift found.
- **2026-07-24** — Gave `libs/scheduler` its first real consumer (`libs/auth` Loop 024): a
  `auth.refresh-token-purge` `@ScheduledJob` that deletes revoked/expired `auth_refresh_tokens` rows
  past a configurable grace window (default 24h, to keep `rotate()`'s reuse-detection able to
  observe a just-revoked row for a while). Chosen over the other unwired-cleanup candidate found in
  the same audit (`libs/queue`'s outbox table never prunes dispatched rows) per user confirmation.
  Unit + real-sqlite integration tests pass (1305/1313 monorepo-wide); live-verified against real
  MySQL/RabbitMQ, which surfaced a real Critical bug in `libs/scheduler`'s `computeNextFireAt` — an
  omitted `timezone` option silently defaults to the host process's local system timezone instead of
  UTC, invisible in that library's own prior live verification since it never checked absolute fire
  time against true UTC wall-clock. Fixed at the process level (`TZ=UTC` in `.env`/`.env.example`)
  rather than in library code, since the same gap would otherwise recur for every future
  `@ScheduledJob` consumer; `MYSQL_TIME_ZONE` was also corrected from the mysql2-invalid `UTC` to
  the valid `Z` keyword as an independent, smaller fix caught along the way (prevents a documented
  future mysql2 breaking change). See `libs/auth/LOOP.md` Loop 024 and `libs/scheduler/LOOP.md`
  Loop 003 for full detail; the library-level design question (should `libs/scheduler` default or
  require an explicit `timezone` instead of silently inheriting local time) is deliberately left
  open for a future `libs/scheduler` loop rather than decided as a bug-fix-in-passing.
- **2026-07-24** — Closed the open question from the entry above (`libs/scheduler/LOOP.md` Loop 004,
  decided with the user): `@ScheduledJob` now defaults an omitted `timezone` to `'UTC'` at the
  decorator level, rather than "fail loud" or "leave as-is." Non-breaking (only changes behavior for
  call sites that already omitted `timezone`); `auth.refresh-token-purge`'s now-redundant explicit
  `{ timezone: 'UTC' }` was removed. Live-verified against real MySQL with no `TZ=UTC` process
  override needed — the process-level fix from the entry above remains in place as defense-in-depth,
  but is no longer the only thing preventing drift.

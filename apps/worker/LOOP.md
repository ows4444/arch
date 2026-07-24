# Loop 001

**App:** worker

**Date:** 2026-07-21

## Goal

First ci.loop pass over `apps/worker`, alongside the same pass over `apps/server` (see
`apps/server/LOOP.md` Loop 001).

## Files Reviewed

- `apps/worker/src/worker.module.ts`, `main.ts`, `worker.controller.ts`, `worker.service.ts`
  (entire app — four files)
- `docker/compose/compose.yml` (confirmed only MySQL/Redis/RabbitMQ infra is defined; no
  server/worker containers)
- Root `package.json` scripts (confirmed no `start:worker`-style script exists — `start:dev`/
  `start:prod` both target `apps/server` specifically via `nest-cli.json`'s top-level
  `sourceRoot`/`root: apps/server`)

## Problems Found

**Critical**
- (none)

**High**
- `apps/worker` is the unmodified `nest g app worker` scaffold: `WorkerModule` imports nothing
  (`imports: []`), and `WorkerController`/`WorkerService` are the default `getHello()` /
  `'Hello World!'` pair. It doesn't import `QueueModule`, `WorkflowModule`, or any other `@/*`
  library — it has no path to ever consume a queue message or drive workflow execution. Combined
  with the `apps/server/LOOP.md` Loop 001 finding (zero `@RMQConsumer` classes exist anywhere),
  this app currently does nothing a real "worker" process would do, and nothing in
  `nest-cli.json`/`package.json`/`docker-compose` treats it as a real deployable — it's dead
  weight in the monorepo today, not a functioning second process.

**Medium / Low**
- (none beyond the shared finding above)

## Changes Made

- (none — building out real consumer/workflow-runner logic here is a product decision, not a
  passive cleanup; see Why)

## Why

- Per Section 18, adding real queue consumers or a workflow-runner bootstrap to this app is a
  Medium/High-risk change (new consumer surface, retry/ack semantics, a second real deployable)
  that needs explicit justification/scope from the user, not something to invent speculatively
  during a review pass. Per Section 17 ("never rewrite code simply because you prefer another
  style" / don't build unrequested features), the correct action this loop is to surface the gap
  clearly, not silently fill it.

## Tests

No test changes. `worker.controller.spec.ts` (the one existing test) still passes as part of the
full repo suite (133 suites / 1040 tests).

## Build

PASS

## Lint

PASS

## Remaining TODO

- Decide `apps/worker`'s actual purpose: either (a) give it real `@RMQConsumer` handlers +
  `QueueModule.forRoot`/`WorkflowModule.forRoot` wiring so it becomes the process that drains what
  `apps/server`'s outbox publishes, or (b) remove it from the monorepo if it's not going to be
  developed, so it stops implying a working second deployable that doesn't exist. Left to the user
  — this is a scope decision, not a defect to autofix.

## Next Loop

- Driven by the user's decision above, not forced.

---

# Loop 002

**App:** worker

**Date:** 2026-07-21

## Goal

Close the Loop 001 gap: user chose "wire QueueModule/WorkflowModule into `apps/worker` and add a
minimal example `@RMQConsumer` + matching publish call, proving the full path works end-to-end —
no real business meaning, a scaffold for real handlers." (Not WorkflowModule — no concrete
workflow-runner need was identified; scope was queue plumbing only, confirmed with the user before
implementing.)

## Files Reviewed

- `libs/queue/src/index.ts` (confirmed `defineTopology`/`queue`/`retry`, `OutboxService`,
  `RMQConsumer`, `QUEUE_TYPEORM_ENTITIES`/`QUEUE_MIGRATIONS` are all exported from the barrel)
- `libs/queue/src/topology/topology.builder.ts` + `topology.contracts.ts` (topology-as-code shape:
  `defineTopology({ exchange, queues: { name: queue({ routingKey, dlq, retry }) } })`)
- `libs/queue/src/consumer/rmq-consumer.decorator.ts` + `rmq-handler.types.ts` +
  `rmq-handler.registry.spec.ts` (confirmed `@RMQConsumer(topology.QUEUES.x, { payload })` on a
  method with signature `(payload, context: RMQContext) => void | Promise<void>`)
- `libs/queue/src/outbox/outbox.service.ts` (`OutboxService.enqueue({ exchange, routingKey,
  payload })` — the only way to publish without reaching for `RMQPublisher` directly, consistent
  with `outbox: {}` being enabled)
- `libs/queue/src/consumer/rmq-consumer.runtime.ts` (confirmed `OnApplicationShutdown` is what
  drains in-flight consumers gracefully — requires `app.enableShutdownHooks()` in `main.ts`,
  which `apps/server` already had and `apps/worker` didn't)
- `libs/database/src/interfaces/database-bootstrap-options.interface.ts` (confirmed the same
  `entities` call-signature typing gap flagged in Loop 001 also applies here — same
  `as unknown as DatabaseBootstrapOptions['entities']` cast needed, not a new issue)
- `apps/server/src/validation-rules/validation-rule.controller.spec.ts` (the established
  direct-instantiation controller-spec convention, mirrored for `WorkerController`)

## Problems Found

**Critical / High / Medium**
- (none — this loop only builds what was explicitly scoped)

**Low**
- (none)

## Changes Made

- `apps/worker/src/queue/worker-smoke-test.topology.ts`: new — `WORKER_SMOKE_TEST_TOPOLOGY`, a
  `worker.smoke-test` exchange with one `ping` queue (DLQ + `[1, 5, 15]`s retry strategy), built
  with `defineTopology`/`queue`/`retry` from `@/queue`.
- `apps/worker/src/queue/worker-smoke-test-ping.payload.ts`: new — `WorkerSmokeTestPingPayload`
  (`@IsString() message`), the consumer's declared `payloadType`.
- `apps/worker/src/queue/worker-smoke-test.consumer.ts`: new — `WorkerSmokeTestConsumer`, an
  `@RMQConsumer` handler that logs the received payload + `requestId`/`correlationId`.
- `apps/worker/src/worker.controller.ts`: added `POST /smoke-test/ping`, which calls
  `OutboxService.enqueue` on the smoke-test topology — a manual trigger rather than firing on
  every boot, so the pipeline is exercised on demand.
- `apps/worker/src/worker.module.ts`: now imports `ConfigModule.forRoot({ isGlobal: true })`,
  `DatabaseModule.forRoot({ entities: QUEUE_TYPEORM_ENTITIES, migrations: QUEUE_MIGRATIONS })`
  (only the queue lib's schema — this app hosts no auth/workflow/validation modules), and
  `QueueModule.forRoot({ uri, topology: [WORKER_SMOKE_TEST_TOPOLOGY], outbox: {}, inbox: true })`.
  Registers `WorkerSmokeTestConsumer` as a provider so `DiscoveryModule` finds it.
- `apps/worker/src/main.ts`: added `app.enableShutdownHooks()` (graceful consumer drain) and the
  same global `ValidationPipe` config `apps/server` uses (needed now that there's a validated DTO
  on the wire). Default port changed from the shared `PORT` env var to its own `WORKER_PORT`
  (default `3001`) so both apps can run simultaneously without a port collision.
- `package.json`: added `start:worker`, `start:worker:dev`, `start:worker:prod` scripts (there was
  previously no way to actually launch this app — `start`/`start:dev` are hardcoded to the
  `server` project via `nest-cli.json`'s monorepo root).
- `.env.example`: added `WORKER_PORT=3001`.
- Tests: `worker.controller.spec.ts` rewritten to the direct-instantiation convention (the old
  `Test.createTestingModule` version broke once the constructor gained an `OutboxService`
  dependency with no provider registered in that bare testing module) plus a new `ping` case;
  `worker-smoke-test.consumer.spec.ts` and `worker-smoke-test.topology.spec.ts` added.

## Why

- Confirmed with the user (via clarifying question) that no real publisher exists anywhere in the
  repo yet (`grep` for `OutboxService.publish`/`RMQPublisher.publish` across `apps/*` and
  `libs/*` — zero hits), so a concrete business consumer would mean fabricating domain meaning
  that doesn't exist. The user chose the smoke-test-scaffold option specifically to avoid that.
- Self-contained within `apps/worker` (enqueue and consume both happen in this one process)
  rather than splitting the publish side into `apps/server` — `apps/*` don't import from each
  other in this monorepo, and there's no existing shared "message contracts" library to hold a
  topology both apps would need to reference by the same object identity. Keeping it one-sided
  avoids inventing that new shared-library decision inside what was scoped as a smoke test.

## Live verification performed (real MySQL/RabbitMQ)

- Booted `apps/worker` for real (`npx nest start worker`) against the already-running
  `docker/compose` MySQL/RabbitMQ containers: confirmed `DatabaseCoreModule`/`QueueModule` both
  initialized, `TopologyBootstrap` declared the `worker.smoke-test` exchange/queue/DLQ,
  `RMQConsumerRuntime` registered a consumer on `worker.smoke-test.ping`, and
  `RepositoryDiscoveryService` found the queue lib's `OutboxRepository`/`InboxRepository`
  (confirming the narrower `DatabaseModule.forRoot({ entities: QUEUE_TYPEORM_ENTITIES })` slice
  works standalone, without auth/workflow/validation entities).
- `curl -X POST localhost:3001/smoke-test/ping -d '{"message":"live-test-1"}'` → `200` with a
  `messageId`; `WorkerSmokeTestConsumer` logged receipt of the same payload within the same
  second — full outbox → dispatcher → RabbitMQ publish → topology → consumer → handler path
  confirmed working end-to-end, not just type-checking.
- Verified the row in `queue_outbox` (via `docker exec` into the MySQL container, no local mysql
  client available) reached `status = 'published'`, then deleted the one test row to leave the
  dev database clean.
- Stopped the test process; confirmed no leftover `nest start worker` process afterward.

## Tests

7 new tests across 3 new spec files + the rewritten `worker.controller.spec.ts` (was 1 test, now
2). Full repo suite: 135 suites / 1043 tests passing.

## Build

PASS (`nest build` for `server`, `npx nest build worker` for `worker` — verified both explicitly,
since plain `nest build` only builds the monorepo's root project)

## Lint

PASS

## Typecheck

PASS

## Remaining TODO

- No real business consumer yet — `WorkerSmokeTestConsumer` is scaffolding, not a domain handler.
  The next real step here is whichever concrete business event actually needs async processing;
  building one speculatively wasn't in scope for this loop.
- `libs/database`'s `entities` interface typing gap (Low, `apps/server/LOOP.md` Loop 001) — the
  same cast was needed again here; still belongs in `libs/database`'s own loop, not fixed twice
  independently in each app.
- `apps/worker` still isn't in `docker-compose` as a real deployable — left out; adding a
  container definition wasn't asked for and the app can be run locally via the new
  `start:worker`/`start:worker:dev` scripts.

## Next Loop

- None forced. `apps/worker` is now a real, working second process with live-verified queue
  wiring. Further work should wait for an actual business event to consume.

---

# Loop 003

**App:** apps/worker
**Date:** 2026-07-23

## Goal

Give `apps/worker` its first real (non-smoke-test) functionality: consume the email-send messages
`apps/server` now publishes via the new `libs/notification` library (see
`libs/notification/ARCH.md`/`LOOP.md` Loop 001).

## Changes Made

- New `src/queue/email-notification.consumer.ts` (`EmailNotificationConsumer`): a thin
  `@RMQConsumer` handler for `NOTIFICATION_EMAIL_TOPOLOGY.QUEUES.send` that calls
  `NotificationService.sendEmail(payload)`.
- `worker.module.ts`: `NOTIFICATION_EMAIL_TOPOLOGY` added to `QueueModule.forRoot`'s `topology`
  array alongside the existing smoke-test topology; `NotificationModule.forRoot({ emailSender: new
  LoggingEmailSender() })` registered (same adapter as `apps/server`).

## Tests

1 new test (`email-notification.consumer.spec.ts`). See `libs/notification/LOOP.md` Loop 001 for
the combined suite count and the live verification that booted this app for real and confirmed a
message published by `apps/server` was received and logged here.

## Build / Lint

PASS (see `libs/notification/LOOP.md` Loop 001).

## Next Loop

- None forced. Next real functionality for this app should come from another concrete event
  needing a background consumer.

---

**Addendum (2026-07-22):** The `libs/database` `entities` type-cast noted above as a Remaining
TODO (Loop 002) is resolved — see `libs/database/LOOP.md` Loop 006. `apps/worker/src/worker.module.ts`
no longer needs the `as unknown as DatabaseBootstrapOptions['entities']` cast.

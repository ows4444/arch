# Design 001

**Library / Bounded Context:** libs/notification
**Date:** 2026-07-23

## Goal

Build the Notification Service — `REQUIREMENTS.md` Tier 3, "natural consumer of `libs/queue`'s
outbox → publish → `apps/worker`, which already exists but is empty." Started because a concrete
gap already exists: `libs/auth`'s `AUTH_EVENT_PUBLISHER` defaults to `NoopAuthEventPublisher`, so
`PasswordResetRequestedEvent`/`EmailVerificationRequestedEvent` — which already carry a raw
token — currently go nowhere. No email is ever actually sent for password reset or email
verification today.

## Scale/Team Context Assumed

Unchanged from every prior Design Mode session. Sections 0.9–0.18 collapse to "not applicable."

## Context Gathering (Section 0.2) — Scope & Mechanism

Two decisions confirmed directly with the user before designing further:

- **Channel scope: email only.** `REQUIREMENTS.md` lists email/SMS/push/in-app, but only email has
  a concrete trigger today (the two auth events above). SMS/push/in-app have no stated consumer;
  building stub ports for them now would be exactly the speculative generality Section 0.1 warns
  against. Add a channel when a concrete trigger for it exists, not before.
- **Consumer ownership: `apps/worker` owns the real send** — `libs/notification` stays generic
  (a `NotificationService` + pluggable `EMAIL_SENDER` port, no-op default), with no
  domain-specific event knowledge and no consumer of its own tied to `libs/auth`'s event shapes.
  `apps/server` translates auth events into a generic email message and publishes it via the
  outbox; `apps/worker`'s own consumer receives it and calls `NotificationService.sendEmail(...)`.
  Rejected alternative: `libs/notification` owns the RMQConsumer/topology end-to-end (like
  `libs/auth`'s batteries-included `AuthController`) — rejected because that would couple a generic
  infrastructure library to `libs/auth`-specific event shapes, unlike `AuthController`, which is
  genuinely part of `libs/auth`'s own domain.

## Bounded Contexts Identified

- **Notification — a generic cross-cutting infrastructure concern**, same class as `libs/cache`/
  `libs/ratelimit`/`libs/audit`, not a domain library. It delivers an already-composed email
  message; it has no knowledge of *why* an email is being sent.

## Context Map

- **No dependency on `libs/database`.** Unlike every other library built this session,
  `libs/notification` has no persisted state at all — sending an email is a stateless passthrough
  to a port, not an aggregate with a lifecycle. (If delivery-status tracking or a "notification
  history" becomes a real requirement later, that's a new, separate design decision — not
  speculatively built now.)
- **No dependency on `libs/auth`.** `libs/notification`'s `EmailMessage` shape (`to`/`subject`/
  `text`/`html?`) is generic — it doesn't know what a "password reset" or "email verification" is.
  That domain knowledge (composing the actual subject/body wording) stays in `apps/server`, close
  to `libs/auth`'s domain, not inside this library.
- **Topology definition lives in `libs/notification`, not duplicated across `apps/server`/
  `apps/worker`.** This is the one place this design's mechanism decision (above) needed refining:
  `apps/worker`'s existing convention duplicates env-plumbing across apps ("apps/* don't import
  from each other," `apps/worker/LOOP.md` Loop 002) because that plumbing is trivial and
  app-specific. An exchange/routing-key/queue *name*, by contrast, must be byte-for-byte identical
  between the app that publishes (`apps/server`) and the app that consumes (`apps/worker`), or the
  message never arrives — hardcoding the same three strings independently in both apps is a latent
  drift bug waiting to happen. `libs/notification` exports one `NOTIFICATION_EMAIL_TOPOLOGY`
  constant (`libs/queue`'s `defineTopology`) and one `EmailMessagePayload` class; both apps import
  it from `@/notification`, so there is exactly one place that can define these names.
- **`libs/queue` (upstream, hard dependency, but only for the topology-as-code helpers
  (`defineTopology`) and the `EmailMessagePayload`'s use in a `@RMQConsumer`, not for
  publishing).** `libs/notification` itself never calls `OutboxService`/`RMQPublisher` — the
  library only defines *what* an email-send message looks like; the actual enqueue happens in
  `apps/server` (which already depends on `@/queue` directly), and the actual consume happens in
  `apps/worker` (same).

No cyclic dependency: `libs/notification` → `@/queue` (topology helper + payload class only); no
lib depends back on `libs/notification` except at the two host apps' composition layer.

## Architecture Style Recommendation

Modular monolith, unchanged.

## Module Breakdown

```
libs/notification/src/
  index.ts                              # public barrel

  notification.module.ts                # NotificationModule.forRoot/forRootAsync
  notification.constants.ts             # EMAIL_SENDER token

  ports/
    email-sender.interface.ts           # EmailSender { send(message): Promise<void> }
    email-message.interface.ts          # EmailMessage { to, subject, text, html? }

  adapters/
    noop-email-sender.ts                # default — silent no-op, matches every other
                                         # Noop* adapter in this monorepo
    logging-email-sender.ts             # logs the would-be email at INFO level — the
                                         # closest thing to a "real" adapter available
                                         # without an actual SMTP/SendGrid dependency,
                                         # which doesn't exist anywhere in this monorepo

  application/
    notification.service.ts             # NotificationService.sendEmail(message)

  queue/
    notification-email.topology.ts      # NOTIFICATION_EMAIL_TOPOLOGY (exchange
                                         # 'notifications.email', one queue 'send',
                                         # dlq + retry)
    email-message.payload.ts            # EmailMessagePayload (class-validator, the
                                         # @RMQConsumer payload shape)
```

## Aggregate Design

Not applicable — no persisted aggregate, same as `libs/ratelimit`.

## Domain Model

- `EmailMessage` / `EmailMessagePayload`: `to (string)`, `subject (string)`, `text (string)`,
  `html? (string)`. Deliberately generic — no `purpose`/`kind` discriminant, since this library
  doesn't need to know why an email is being sent, only what to send.

## Application Layer (Use Cases)

- `NotificationService.sendEmail(message: EmailMessage)` — the only use case. Delegates to
  whichever `EMAIL_SENDER` is wired.

## Commands / Queries / Events / Engines / Policies / Workflows / Sagas

Not applicable — one stateless method, no branching logic, no persisted state, no multi-step
process.

## Data Architecture

None — no datastore dependency at all (see Context Map).

## Messaging Architecture

- `NOTIFICATION_EMAIL_TOPOLOGY`: exchange `notifications.email` (topic), one queue `send`
  (`dlq: true`, `retry: { strategy: [1, 5, 15] }` — matching the existing smoke-test topology's
  shape). `apps/server` publishes via `OutboxService.enqueue({ exchange, routingKey, payload })`
  (transactional outbox — reuses `libs/queue`'s existing reliability pattern exactly, never
  publishes directly per that library's established rule); `apps/worker` consumes via a new
  `@RMQConsumer` handler that calls `NotificationService.sendEmail(payload)`.

## Reliability Architecture

- **Outbox**: reuses `libs/queue`'s `OutboxService` as-is (already enabled in both `apps/server`
  and `apps/worker`'s `QueueModule.forRoot({ outbox: {} })`) — no second outbox implementation.
- **Retry/DLQ**: reuses `libs/queue`'s existing retry-policy/dead-letter mechanism on the one
  queue — no new reliability primitive invented.

## Security Architecture

- `EmailMessage.text`/`html` may carry a raw password-reset/email-verification token (the exact
  reason `libs/auth`'s `PasswordResetRequestedEvent`/`EmailVerificationRequestedEvent` carry it
  unhashed — see those events' own doc comments). `libs/notification` doesn't log message bodies by
  default (`NoopEmailSender` is silent); `LoggingEmailSender` does log them at INFO level, so it
  should only be wired in non-production-sensitive environments — flagged in its own doc comment,
  not enforced in code, since there is no concrete production-deployment requirement in this
  monorepo to design an environment gate against yet.

## Scalability

Stateless, no in-memory state, no bottleneck introduced.

## Folder Structure

See Module Breakdown — one new top-level `queue/` folder (topology + payload), otherwise matching
every sibling lib's flat layout.

## Design Patterns

- **Adapter** (`NoopEmailSender`/`LoggingEmailSender` behind `EMAIL_SENDER`) — used, matches
  `PASSWORD_HASHER`/`ACCESS_TOKEN_DENYLIST`'s exact shape.
- Nothing else — one message shape, one method, no branching worth a named pattern.

## CQRS / Event Sourcing Decisions

Both not applicable — no persisted state, no query side.

## Rejected Alternatives

- **All four channels (SMS/push/in-app) stubbed now** — rejected; see Context Gathering.
- **`libs/notification` owning the RMQConsumer/topology end-to-end** — rejected; see Context
  Gathering.
- **Auth-specific payload/topology naming inside `libs/notification`** (e.g. a
  `PasswordResetEmailPayload`) — rejected in favor of one fully generic `EmailMessagePayload`;
  keeps this library reusable by any future event source that wants to send an email, and keeps
  the "why" (subject/body wording) in `apps/server`, close to the domain that actually knows it.
- **A real SMTP/SendGrid/SES adapter** — not built; no such dependency exists anywhere in this
  monorepo and none was requested. `LoggingEmailSender` is the honest placeholder until a real
  provider is a stated requirement.

## Key Decisions (with risk tag)

**CRITICAL**
- None.

**HIGH**
- None. Nothing here reaches a bounded-context boundary — this is infrastructure, not a new Core
  Domain.

**MEDIUM**
1. `NOTIFICATION_EMAIL_TOPOLOGY`/`EmailMessagePayload` live in `libs/notification`, not duplicated
   across `apps/server`/`apps/worker` — see Context Map for the drift-risk reasoning. Both apps
   import them from `@/notification`.
2. No `libs/database` dependency at all, unlike every other library built this session — no
   persisted state exists in this design's scope.

**LOW**
- Folder layout — see Module Breakdown.

## Open Questions / Future Evolution

- **A real email provider adapter** (SMTP/SendGrid/SES) — build when actually deploying somewhere
  that needs real delivery; `LoggingEmailSender` is the interim default until then.
- **SMS/push/in-app channels** — add a channel when a concrete trigger for it appears (e.g. an
  in-app notification would need its own persisted "notification" entity, a materially bigger
  design than this one — a new Design Mode session, not an extension of this one).
- **Wiring `libs/auth`'s other four events** (`UserRegistered`, `UserLoggedIn`, `PasswordChanged`,
  `RefreshTokenReuseDetected`) to send an email (e.g. a "welcome" email, a security alert) — not in
  this design's scope; only `PasswordResetRequestedEvent`/`EmailVerificationRequestedEvent` have a
  stated need (the raw token has nowhere to go without this). Add the others if a concrete product
  requirement appears.

## Handoff to Improvement Loop

- **Public API surface (`libs/notification/src/index.ts`):** `NotificationModule` (`forRoot`/
  `forRootAsync`), `NotificationService`, `EMAIL_SENDER`/`EmailSender`, `EmailMessage`,
  `NoopEmailSender`, `LoggingEmailSender`, `NOTIFICATION_EMAIL_TOPOLOGY`, `EmailMessagePayload`.
- **Module boundaries:** `libs/notification` → `@/queue` (topology helper + payload class only,
  no publish/consume calls of its own).
- **First Improvement Loop should implement exactly this scope**: `NotificationService` +
  `EMAIL_SENDER` port + the shared topology/payload, a new `QueueAuthEventPublisher` in
  `apps/server` (wired as `libs/auth`'s real `AuthEventPublisher`, implementing only
  `publishPasswordResetRequested`/`publishEmailVerificationRequested` for real — the other four
  methods stay no-op, matching today's behavior, per Open Questions), and a new email-send consumer
  in `apps/worker`. No SMS/push/in-app, no real SMTP provider, no in-app notification storage.

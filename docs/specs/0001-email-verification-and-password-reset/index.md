# 0001. Email Verification and Multi-Channel Password Reset

**Date**: 2026-08-15
**Status**: In Progress

## Summary

Logged-in users can add and verify an email address by receiving a 6-digit OTP to that address, consistent with the phone OTP flow already in the project. Users who forget their password can request a reset link delivered to their verified phone (via SMS or WhatsApp) or verified email. They click the link, land on a frontend page, and enter their new password twice. All short-lived tokens live in Redis with a 5-minute TTL and are consumed on use.

## Context

The app currently verifies only phone numbers at registration. Email is stored on the user record but never confirmed, so any address can be entered without the owner's consent. There is also no way for a user to regain access after forgetting their password, which is a critical gap for a fintech product.

Two related flows need adding: one to confirm ownership of an email address after login, and one to reset a forgotten password via a channel the user can still reach (phone is always available; email is only available once verified). Both flows reuse the existing Redis-based OTP infrastructure for storage and the SmsService for delivery, extending it with a MailService and an Africa's Talking WhatsApp call.

## Requirements

**User stories**:
- As a logged-in user, I want to verify my email address so that I can use it as a reset channel and prove ownership.
- As a user who has forgotten their password, I want to receive a reset link via SMS, WhatsApp, or email so that I can set a new password without contacting support.

**Acceptance criteria**:
- **AC-1**: When a logged-in user updates their email via `PATCH /users/:id`, a 6-digit OTP is sent to the new email address and `isEmailVerified` is set to `false`. The old email (if any) remains active until the new one is confirmed.
- **AC-2**: `POST /auth/email/verify` with a valid OTP sets `isEmailVerified: true` on the user. A wrong or expired OTP returns `401`.
- **AC-3**: `POST /auth/password/request` accepts a phone number and a `channel` (`sms`, `whatsapp`, or `email`). The `email` channel is only allowed when `isEmailVerified: true`; otherwise it returns `400`. A signed JWT reset token is stored in Redis with a 5-minute TTL, and the reset link is delivered through the chosen channel.
- **AC-4**: The reset link format is `${FRONTEND_URL}/reset-password?token=<signed-jwt>`. The link is delivered as plain text in SMS and WhatsApp messages and as an HTML link in the email.
- **AC-5**: `POST /auth/password/confirm` accepts `{ token, newPassword, confirmPassword }`. It verifies the JWT signature, checks the Redis key still exists (not expired or already consumed), validates that `newPassword === confirmPassword` and meets the existing password policy, hashes the new password, updates the user, and deletes the Redis key. Returns `200 { message }` on success and `401` if the token is invalid, expired, or already used.
- **AC-6**: A consumed or expired reset token is rejected immediately. The same token cannot be used twice.
- **AC-7**: `POST /auth/password/request` is rate limited to 3 requests per minute per IP, consistent with `POST /auth/otp/send`.
- **AC-8**: If the phone number in `POST /auth/password/request` is not found in the database, the endpoint returns the same success-shaped response as a real request (no phone enumeration).

## Options considered

### Option 1: Redis-only token storage (no schema change beyond isEmailVerified)

Store both the email OTP and the password reset JWT entirely in Redis, keyed by userId. The only permanent schema change is the `isEmailVerified` column.

**Pros**:
- Tokens expire automatically without a cleanup job.
- Consistent with the existing phone OTP approach already in the project.
- No extra table or cleanup cron needed.

**Cons**:
- `isEmailVerified` must still be stored permanently; a migration is unavoidable.
- Redis must be available for login-adjacent flows (already a project dependency, so acceptable).

### Option 2: New VerificationToken table in Postgres

Store all short-lived tokens in a dedicated Postgres table with an `expiresAt` column and a cleanup job.

**Pros**:
- Survives Redis restarts.
- Queryable for audit logs.

**Cons**:
- Adds a table and a cleanup job for data that expires naturally in Redis.
- More complexity for no reliability gain, given Upstash Redis is persistent.

### Option 3: Columns on the User table for the reset token

Store `passwordResetToken` and `passwordResetExpiresAt` columns on User.

**Pros**:
- No external dependency for the token storage.

**Cons**:
- Pollutes the User model with transient state.
- Does not handle concurrent reset requests cleanly without extra locking.
- Requires a cleanup pass or cron to remove stale columns.

## Decision

**Chosen option**: Option 1, Redis-only token storage, with `isEmailVerified` added as the sole permanent schema change.

Store the email verification OTP in Redis under `email-otp:<userId>` and the password reset JWT under `pwd-reset:<userId>`, both with a 5-minute TTL. One migration adds `isEmailVerified boolean NOT NULL DEFAULT false` to the users table.

**Implementation skills**: `prisma-cli` (`.agents/skills/prisma-cli/`) · `prisma-client-api` (`.agents/skills/prisma-client-api/`)

## Rationale

Both flows require tokens that expire and must be consumed exactly once. Redis with native TTL handles both properties natively, and the project already uses Upstash Redis for the phone OTP flow. Introducing a Postgres table (Option 2) or User columns (Option 3) for inherently transient state adds complexity and cleanup work with no reliability benefit. The only permanent fact is whether the email was confirmed, which belongs in the database.

Keying reset tokens by `userId` rather than phone means a new request atomically overwrites the old one, so there is never a window where two valid reset links coexist for the same user. This is the correct security behaviour: only the most recent link works.

## Feature design

**Data model sketch**:

`User` table (existing, one new column only):
- `isEmailVerified` boolean, NOT NULL, DEFAULT false (new column via migration)

Redis keys (transient, TTL enforced by Redis):
- `email-otp:<userId>` — JSON `{ codeHash: string, attempts: number }`, TTL 300 seconds
- `pwd-reset:<userId>` — string (the signed JWT itself), TTL 300 seconds

**State transitions**:

Email address lifecycle on the User record:
```
no email set
  → email set (unverified): PATCH /users/:id sets isEmailVerified=false, OTP sent
  → email verified:         POST /auth/email/verify with correct OTP, isEmailVerified=true
  → email changed again:    PATCH /users/:id resets isEmailVerified=false, new OTP sent
```

Password reset lifecycle:
```
no token
  → token issued:   POST /auth/password/request, signed JWT stored in Redis (TTL 5 min)
  → token consumed: POST /auth/password/confirm success, password updated, Redis key deleted
  → token expired:  Redis TTL fires, key gone, any subsequent confirm returns 401
```

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/auth/email/verify` | POST | `otp: string` (6 digits, req) | `{ message }` | Bearer (JwtAuthGuard) | 401 wrong/expired OTP, 400 no email on account |
| `/auth/password/request` | POST | `phone: string` (CM, req), `channel: 'sms'|'whatsapp'|'email'` (req) | `{ message }` | Public | 400 email channel but not verified, 429 rate limit |
| `/auth/password/confirm` | POST | `token: string` (req), `newPassword: string` (req), `confirmPassword: string` (req) | `{ message }` | Public | 401 invalid/expired/used token, 400 passwords mismatch or fail policy |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| `POST /auth/email/verify` OTP lookup | `userId` for Redis key | `CurrentUser` decorator from verified JWT |
| `POST /auth/email/verify` OTP lookup | user's current email to confirm OTP target | User row fetched by `userId` from PrismaService |
| `POST /auth/email/verify` success | `isEmailVerified = true` written to DB | Derived: OTP bcrypt match passed |
| `POST /auth/password/request` | `userId` for Redis key and JWT `sub` | User row found by `phone` from PrismaService |
| `POST /auth/password/request` | `isEmailVerified` gate for email channel | `user.isEmailVerified` column from DB row |
| `POST /auth/password/request` | signed JWT | `{ sub: userId }` signed with `JWT_SECRET`, exp 300 s |
| `POST /auth/password/request` | reset link | `${FRONTEND_URL}/reset-password?token=<jwt>` |
| `POST /auth/password/confirm` | `userId` from token | JWT `sub` claim, verified with `JWT_SECRET` |
| `POST /auth/password/confirm` | token still live | Redis key `pwd-reset:<userId>` exists and value matches submitted token |
| `POST /auth/password/confirm` | new password hash | `bcrypt.hash(newPassword, 10)` |
| Email OTP sent on `PATCH /users/:id` | OTP code (6 digits) | `randomInt(100_000, 1_000_000)` in EmailOtpService |
| Email OTP sent on `PATCH /users/:id` | recipient address | `dto.email` from PATCH body |

**Key invariants**:
- A user can have at most one live email OTP at a time. A new PATCH overwrites the Redis key.
- A user can have at most one live reset token at a time. A new request overwrites the old one.
- The `email` channel is rejected unless `user.isEmailVerified === true`.
- `newPassword` must pass the existing policy (min 8 chars, one lowercase, one uppercase, one digit).
- `newPassword` and `confirmPassword` must match; mismatch returns 400 before any DB write.
- A reset token is deleted from Redis immediately after a successful confirm. Replay returns 401.

**Security model**:
- `POST /auth/email/verify` requires a valid Bearer JWT. The OTP lookup uses the authenticated user's ID from the JWT, never a caller-supplied ID, so a user cannot verify another user's email.
- `POST /auth/password/request` is public but rate-limited (3/min/IP). It returns an identical response whether or not the phone exists, preventing phone enumeration.
- `POST /auth/password/confirm` is public. The signed JWT carries `userId`; the backend verifies signature integrity plus Redis presence before writing. Neither the JWT secret nor the Redis key is accessible to an unauthenticated caller.
- Password hashes are never read or returned during the reset flow; only a newly computed hash is written.
- SMS and WhatsApp messages contain only the reset link, no account details.

**Configuration required**:
- `FRONTEND_URL`: base URL of the frontend app (e.g. `http://localhost:5173` in dev). Assembled as `${FRONTEND_URL}/reset-password?token=...`.
- `RESEND_API_KEY`: Resend API key for email delivery.
- `RESEND_FROM_EMAIL`: verified sender address in Resend (e.g. `noreply@moani.app`).
- `AT_API_KEY`: Africa's Talking API key (covers both SMS and WhatsApp channels).
- `AT_USERNAME`: Africa's Talking account username (required by the AT Node SDK).
- `AT_WHATSAPP_NUMBER`: Africa's Talking WhatsApp sender channel number.

**Critical test scenarios**:
- Happy path (email verify): logged-in user PATCHes email, OTP appears in stub log, `POST /auth/email/verify` with correct OTP returns 200, `isEmailVerified` is `true` in DB. Verifies **AC-1**, **AC-2**.
- Happy path (password reset via SMS): `POST /auth/password/request` with `channel: sms` returns 200, link appears in stub log, token extracted, `POST /auth/password/confirm` with valid token and matching passwords returns 200, user can log in with new password. Verifies **AC-3**, **AC-4**, **AC-5**.
- Failure case (token replay): second call to `POST /auth/password/confirm` with the same already-used token returns 401. Verifies **AC-6**.
- Failure case (email channel unverified): `POST /auth/password/request` with `channel: email` when `isEmailVerified: false` returns 400. Verifies **AC-3**.
- Failure case (unknown phone): `POST /auth/password/request` with a phone not in DB returns 200 with the same message as a successful request. Verifies **AC-8**.
- Auth check: `POST /auth/email/verify` with no Bearer token returns 401. Verifies **AC-2**.

## Build plan

1. Write and run migration adding `isEmailVerified boolean NOT NULL DEFAULT false` to the `users` table; regenerate the Prisma client. Satisfies **AC-1**, **AC-2**.
2. Create `src/lib/mail/mail.module.ts` and `mail.service.ts` using the Resend Node SDK. Mark `MailModule` `@Global()` and import it once in `AppModule`. Stub-log the email in dev when `RESEND_API_KEY` is absent (mirrors the SmsService pattern). Satisfies **AC-3**, **AC-4**.
3. Replace the `SmsService` stub with a real Africa's Talking SMS call using the AT Node SDK (`africastalking` npm package). Add a `WhatsappService` (or a `channel` parameter to SmsService) for WhatsApp delivery via the same AT account. Satisfies **AC-3**, **AC-4**.
4. Create `EmailOtpService` in `src/auth/` (mirrors `OtpService`): `send(userId, email)` writes a hashed 6-digit OTP to Redis under `email-otp:<userId>` with 300 s TTL and sends the code via MailService; `verify(userId, otp)` checks the hash and deletes the key on success. Satisfies **AC-1**, **AC-2**.
5. Update `UsersService.update()`: when `dto.email` is present and differs from the current value, set `isEmailVerified: false` on the user row and call `EmailOtpService.send()`. Satisfies **AC-1**.
6. Add `POST /auth/email/verify` to `AuthController` (guarded by `JwtAuthGuard`). Body DTO: `{ otp: string }` (Length 6,6). Calls `EmailOtpService.verify()`, then updates `isEmailVerified: true` via `UsersService`. Satisfies **AC-2**.
7. Create `PasswordResetService` in `src/auth/`: `request(phone, channel)` looks up user by phone, checks email-channel gate, mints a signed JWT (`sub: userId`, exp 300 s), stores it in Redis under `pwd-reset:<userId>`, and delivers the link; `confirm(token, newPassword, confirmPassword)` verifies JWT signature, checks Redis key, validates password match and policy, hashes and writes the new password, deletes the Redis key. Satisfies **AC-3**, **AC-5**, **AC-6**, **AC-8**.
8. Add `POST /auth/password/request` and `POST /auth/password/confirm` to `AuthController`. Apply `ThrottlerGuard` + `@Throttle({ default: { limit: 3, ttl: 60_000 } })` to the request endpoint only. Satisfies **AC-3**, **AC-4**, **AC-7**.
9. Add placeholder values for `FRONTEND_URL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `AT_API_KEY`, `AT_USERNAME`, and `AT_WHATSAPP_NUMBER` to `.env` and `.env.example`. Satisfies **AC-4**.

## Consequences

**Positive**:
- Users can confirm email ownership, enabling a verified second channel for account recovery.
- Password reset is available across all three channels with no Postgres table or cleanup job.
- The approach reuses existing Redis infrastructure and OTP patterns; the mental model stays consistent.

**Negative / tradeoffs**:
- WhatsApp delivery requires an Africa's Talking WhatsApp Business number to be registered and approved before it works in production.
- Resend requires a verified sender domain for production delivery; the `@resend.dev` test address only works in sandbox.
- A new reset request invalidates any previously sent link for the same user. This is the correct security behaviour but can confuse a user who was slow to open the message.

**Neutral**:
- `SmsService` is currently a stub. Step 3 replaces it in one file with no interface changes.
- `FRONTEND_URL` couples the backend to one frontend URL. Revisit if the app goes multi-tenant or multi-frontend.

## Follow-up

- [ ] Register and configure the Africa's Talking WhatsApp Business channel before the whatsapp reset channel goes live in production.
- [ ] Verify the Resend sender domain (`moani.app` or similar) before email delivery goes live.
- [ ] Consider adding an audit log entry on successful password reset (fintech compliance consideration).
- [ ] Remove the `TODO: integrate a real SMS provider` comment from `SmsService` when step 3 is done.

# Verify: Email Verification + Password Reset · spec 0001 · updated 2026-08-15
_Steps derived from spec 0001 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Setup

- Server is running (`npm run start:dev`)
- At least one registered user exists (use the test user from `api_test_guide.md`)
- All steps use `http://localhost:3000` as the base URL

---

## Manual / API steps

### Email verification flow (AC-1, AC-2)

- [ ] Log in to get a JWT: `POST /auth/login` → save the `accessToken`                        → AC-2 (auth requirement)
- [ ] PATCH email: `PATCH /users/:id` with `{ "email": "yourtest@example.com" }` (Bearer token) → response 200, `isEmailVerified: false`  → AC-1
- [ ] Check server console: a `[MAIL STUB]` log line appears with the OTP code              → AC-1
- [ ] Extract the 6-digit code from the log
- [ ] Submit OTP: `POST /auth/email/verify` `{ "otp": "<code>" }` (Bearer token)              → `200 { message }`              → AC-2
- [ ] Confirm: `GET /auth/me` (Bearer token) → `isEmailVerified: true`                       → AC-2
- [ ] Replay OTP: `POST /auth/email/verify` with the same code again                         → `401` (code consumed)           → AC-2 / AC-6

### Email verify — failure cases

- [ ] `POST /auth/email/verify` with no Bearer token                                          → `401 Unauthorized`             → AC-2
- [ ] `POST /auth/email/verify` with a wrong OTP (`"000000"`)                                 → `401 Invalid OTP`              → AC-2
- [ ] Wait for OTP TTL to expire (OTP_TTL_MINUTES, default 10 min in prod; can shorten env for test), then submit → `401 OTP expired` → AC-2
- [ ] `POST /auth/email/verify` with no email set on account                                  → `400 No email address`         → AC-2

---

### Password reset — SMS channel (AC-3, AC-4, AC-5, AC-6, AC-7, AC-8)

- [ ] `POST /auth/password/request` `{ "phone": "<registered_phone>", "channel": "sms" }`    → `200 { message }` (stub log visible) → AC-3, AC-4
- [ ] Check server console: `[SMS STUB]` log shows reset link with `?token=`                  → AC-4
- [ ] Extract the JWT token from the link
- [ ] `POST /auth/password/confirm` `{ "token": "<jwt>", "newPassword": "NewPass99", "confirmPassword": "NewPass99" }` → `200 { message }` → AC-5
- [ ] Log in with new password: `POST /auth/login` with `NewPass99`                           → `200` with JWT                 → AC-5

### Password reset — email channel (AC-3)

- [ ] With `isEmailVerified: false`, request via email channel: `POST /auth/password/request` `{ "phone": "...", "channel": "email" }` → `400 Email channel only available after verification` → AC-3
- [ ] Set `isEmailVerified: true` via email OTP flow above, then repeat request               → `200` + `[MAIL STUB]` log appears → AC-3

### Password reset — WhatsApp channel (AC-3)

- [ ] `POST /auth/password/request` `{ "phone": "...", "channel": "whatsapp" }`               → `200` + `[WHATSAPP STUB]` log   → AC-3, AC-4

### Token consumption / replay (AC-6)

- [ ] After successful `confirm`, submit the same token again                                  → `401 Reset link has already been used` → AC-6
- [ ] Request a new reset → note the token → request reset again (overwrites) → try first token → `401` (overwritten) → AC-6

### Anti-enumeration (AC-8)

- [ ] `POST /auth/password/request` with a phone not in the DB                                → `200 { message }` (same response) → AC-8

### Rate limiting (AC-7)

- [ ] Send 4 rapid requests to `POST /auth/password/request`                                  → 4th request returns `429 Too Many Requests` → AC-7

### Password policy (AC-5)

- [ ] `POST /auth/password/confirm` with `newPassword: "short"` (< 8 chars)                   → `400`                          → AC-5
- [ ] `POST /auth/password/confirm` with `newPassword: "alllowercase1"` (no uppercase)        → `400`                          → AC-5
- [ ] `POST /auth/password/confirm` with `newPassword: "NoDigitHere"` (no digit)              → `400`                          → AC-5
- [ ] `POST /auth/password/confirm` with mismatched passwords                                  → `400 Passwords do not match`  → AC-5

---

## Value sourcing checks

These verify each value traces to its documented source (spec 0001 value sourcing table):

- [ ] `isEmailVerified` in `GET /auth/me` response comes from the DB column (not a cached value) — verify by checking DB directly after verify call → correct column value
- [ ] Reset link URL starts with `FRONTEND_URL` env var value (check `[SMS STUB]` log) → AC-4
- [ ] OTP code in `[MAIL STUB]` log is exactly 6 digits → AC-1
- [ ] After password reset, old password no longer works for login → confirms `passwordHash` was actually written → AC-5

---

## Acceptance-criteria coverage

- AC-1 — PATCH email → isEmailVerified=false + OTP sent: covered by email verification flow steps 2+3
- AC-2 — POST /auth/email/verify success + failure cases: covered by email verification flow steps 5-11
- AC-3 — Channel selection + email gate: covered by SMS, email, and WhatsApp channel steps
- AC-4 — Link format via FRONTEND_URL: covered by value sourcing check on reset link URL
- AC-5 — Confirm: token verify + password policy + DB write: covered by password reset flow steps 5-6 + policy steps
- AC-6 — Token consumed on use / overwritten by new request: covered by token consumption steps
- AC-7 — Rate limit 3/min: covered by rate limiting step
- AC-8 — Anti-enumeration on unknown phone: covered by anti-enumeration step

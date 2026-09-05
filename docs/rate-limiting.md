# Rate Limiting

> Last updated: 2026-09-05  
> Status: **Live in production**

## Overview

The Moani backend uses a two-layer rate limiting strategy:

1. **Per-IP throttling** via `@nestjs/throttler` — applied globally, with per-endpoint overrides for sensitive auth routes.
2. **Per-identifier cooldowns** at the service layer — using Redis TTL keys to enforce resend intervals and attempt limits per phone number or session.

Both layers are independent and apply simultaneously.

---

## Dependencies

| Dependency | Purpose |
|---|---|
| `@nestjs/throttler` ^6.5 | Express-level per-IP rate limiting |
| `ioredis` (via `REDIS_CLIENT`) | Per-phone/session cooldowns. Requires a live Redis instance at `REDIS_URL` |
| Express `trust proxy` = 1 | Ensures `req.ip` reflects the real client behind Railway's proxy |

---

## Global Configuration

- **Baseline limit:** 100 requests / 60 seconds per IP
- **Applied via:** `APP_GUARD` (ThrottlerGuard) in `AppModule` — every route inherits this unless overridden or skipped
- **Storage:** In-memory (default). Must move to Redis/Upstash if scaling to multiple instances.

### Trust Proxy

```ts
// main.ts
app.set('trust proxy', 1);
```

Railway sits behind a reverse proxy. Without this, all requests appear to come from the same internal IP, making rate limiting either useless or overly aggressive.

---

## Per-Endpoint Limits

### Auth Endpoints (stricter overrides)

| Endpoint | Limit | Window | Why |
|---|---|---|---|
| `POST /auth/otp/send` | 3 | 15 min | Protects SMS costs (Africa's Talking). Most critical limit. |
| `POST /auth/login` | 5 | 15 min | Slows credential stuffing / brute-force |
| `POST /auth/password-reset/initiate` | 3 | 15 min | Prevents reset session spam |
| `POST /auth/password-reset/method` | 3 | 15 min | Triggers SMS/email delivery |
| `POST /auth/password-reset/verify-otp` | 5 | 15 min | Limits OTP guessing per IP (service layer also enforces 5 per session) |
| `POST /auth/password-reset/complete` | 3 | 15 min | Prevents password-change replay |

### Excluded Endpoints

| Endpoint | Why |
|---|---|
| `GET /health` | Railway health probes must never be throttled |

### All Other Endpoints

Inherit the global 100 req / 60s limit.

---

## OTP Resend Cooldown (90 seconds)

**Separate from the per-IP throttler.** This is a per-phone-number (or per-session) cooldown enforced at the service layer.

### How it works

1. After a successful OTP send, a Redis key is set with a 90-second TTL:
   - `OtpService`: key `otp-cooldown:<phone>`, TTL 90s
   - `PasswordResetService`: key `pwd-reset-cooldown:<sessionId>`, TTL 90s
2. On the next request for the same phone/session, the service checks `redis.ttl(cooldownKey)`.
3. If TTL > 0, a **409 Conflict** is returned (not 429):

```json
{
  "statusCode": 409,
  "message": "Please wait before requesting another code.",
  "retryAfterSeconds": 47
}
```

4. The cooldown key is set **after** the SMS is successfully sent — a failed send does not lock the user out.

### Why 409, not 429

- **429** is used by the throttler for IP-based rate limiting — a generic "slow down" signal.
- **409** is used for the domain-specific cooldown — the mobile app uses the `retryAfterSeconds` field to show an accurate countdown timer ("Resend in 0:47").
- Using different status codes lets the mobile app show the right UI for each case.

### Interaction with the 3-per-15-min cap

The cooldown and the throttler are **fully independent**:

- A user sends OTP at t=0 → cooldown active until t=90s
- User retries at t=30s → **409** (cooldown, not 429)
- User retries at t=91s → allowed (cooldown expired, 2nd of 3 in the 15-min window)
- User retries at t=181s → allowed (cooldown expired, 3rd of 3)
- User retries at t=271s → **429** (15-min IP cap exhausted, must wait ~12 more min)

---

## OTP Verify Attempt Limits

These are enforced at the service layer (not the throttler) so the OTP itself gets invalidated after too many wrong guesses:

| Service | Max attempts | On exceed |
|---|---|---|
| `OtpService` (phone OTP) | 5 | Redis key deleted — code invalidated, must request new OTP |
| `PasswordResetService` | 5 | Session consumed (`usedAt` set) — must restart the reset flow |
| `EmailOtpService` | 5 | Redis key deleted — same as phone OTP |

These are **in addition to** the per-IP throttler limits.

---

## 429 Response Format

When the throttler (per-IP) rejects a request, the response is:

```json
{
  "statusCode": 429,
  "message": "Too many requests. Please try again later.",
  "retryAfter": 60
}
```

With the HTTP header: `Retry-After: 60`

This is handled by `ThrottlerExceptionFilter` in `src/common/filters/throttler-exception.filter.ts`, registered globally in `main.ts`.

---

## Scaling Notes

> ⚠️ **Single-instance only.** The current setup uses `@nestjs/throttler`'s default in-memory storage. Rate limit counters do not sync across instances.

If the app scales to multiple Railway replicas:

1. Replace the throttler storage with `ThrottlerStorageRedisService` (from `@nestjs/throttler` or a Redis adapter).
2. The per-phone/session cooldowns already use Redis, so they'll work correctly across instances.
3. `TokenBlacklistService` (logout/password-reset) is also in-memory and will need the same treatment.

---

## Files Changed

| File | What |
|---|---|
| `src/main.ts` | `trust proxy`, global `ThrottlerExceptionFilter` |
| `src/app.module.ts` | Global 100/min throttle, `APP_GUARD` |
| `src/app.controller.ts` | `@SkipThrottle()` on health check |
| `src/auth/auth.controller.ts` | Per-endpoint `@Throttle` overrides (15-min windows) |
| `src/auth/otp.service.ts` | 90-second per-phone cooldown |
| `src/auth/password-reset.service.ts` | 90-second per-session cooldown + Redis injection |
| `src/common/filters/throttler-exception.filter.ts` | Custom 429 filter with `Retry-After` header |
| `src/auth/otp.service.spec.ts` | Cooldown unit tests |
| `src/auth/throttle.spec.ts` | Integration throttle tests |

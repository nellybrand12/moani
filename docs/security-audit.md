# Security Audit & Hardening Report

> **Date:** 2026-09-05  
> **Target:** Moani / Finda NestJS Backend (NestJS 11, Prisma 7, Supabase Postgres, Railway deployment)  
> **Auditor:** Security Assessment Pass  
> **Status:** Completed — Findings reported for review (no sweeping changes applied per specification)

---

## Executive Summary

This audit evaluates the application's encryption posture, sensitive field handling, logging hygiene, environment variable security, and NestJS guard-based access control (which serves as the sole access-control layer in place of PostgreSQL Row-Level Security).

### Key Highlights
- 🔴 **HIGH SEVERITY**: `POST /auth/admin/register` is an **unguarded, publicly accessible endpoint**. Any actor with phone OTP verification can create an account with `role: ADMIN` and arbitrary `permissionsLevel`.
- 🔴 **HIGH SEVERITY**: **No HTTPS redirection or HSTS headers** are enforced at the application layer. While Railway terminates TLS, the app lacks an HTTP-to-HTTPS redirect middleware and security headers (`helmet`).
- 🟡 **MEDIUM SEVERITY**: Plaintext OTP codes and password-reset links are printed to application logs in `sms.service.ts`, `whatsapp.service.ts`, and `mail.service.ts` during stub mode and fallback scenarios.
- 🟡 **MEDIUM SEVERITY**: KYC identity document numbers (`idDocumentNumber`) and tax IDs (`taxId`) are stored in plaintext in the database without application-level column encryption.
- 🟡 **MEDIUM SEVERITY**: `TokenBlacklistService` operates entirely in-memory using a JavaScript `Map`. On container restarts or multi-instance deployments, revoked tokens become valid again until natural expiration.
- 🟢 **LOW / INFORMATIONAL**: Password and PIN hashing use `bcrypt` with 10 salt rounds (adequate and standard). OTPs in Redis are stored as bcrypt hashes, never raw codes. All secrets are read via environment variables.

---

## Findings by Severity

| ID | Category | Item | Severity | Status |
|---|---|---|---|---|
| **SEC-01** | Access Control | Publicly accessible `POST /auth/admin/register` without admin authorization | 🔴 HIGH | Flagged for review |
| **SEC-02** | Encryption / TLS | Missing HTTPS enforcement and security headers (`helmet`, HSTS) at application layer | 🔴 HIGH | Flagged for review |
| **SEC-03** | Logging Hygiene | Plaintext OTP and token logging in SMS, WhatsApp, and Mail services | 🟡 MEDIUM | Flagged for review |
| **SEC-04** | Data at Rest | Plaintext storage of KYC document numbers (`idDocumentNumber`) and Tax IDs (`taxId`) | 🟡 MEDIUM | Flagged for review |
| **SEC-05** | Session / Token | `TokenBlacklistService` uses process-scoped in-memory storage instead of Redis | 🟡 MEDIUM | Flagged for review |
| **SEC-06** | Access Control | Defensive check in `UserAccessGuard` for missing `paramId` | 🟢 LOW | Flagged for review |
| **SEC-07** | Configuration | Missing CORS configuration in `main.ts` | 🟢 LOW | Flagged for review |
| **SEC-08** | Cryptography | Bcrypt cost factor evaluation (10 rounds) | 🟢 INFORMATIONAL | Confirmed adequate |

---

## PART 1 — Encryption & Credential Audit

### 1. Transport Encryption & HTTPS Enforcement
- **Infrastructure:** Deployed on Railway behind an Envoy-based reverse proxy terminating TLS.
- **Verification Result:**
  - `src/main.ts` sets `app.set('trust proxy', 1);`, ensuring `req.ip` and `req.protocol` accurately reflect reverse proxy headers (`x-forwarded-proto`, `x-forwarded-for`).
  - **Vulnerability (SEC-02):** The NestJS application itself does not enforce HTTPS. If an HTTP request reaches the server:
    1. There is no middleware redirecting `http` to `https` when `req.headers['x-forwarded-proto'] !== 'https'`.
    2. `Strict-Transport-Security` (HSTS) headers are not sent because `helmet` is not installed or configured.
  - **Recommendation:**
    1. Install `helmet` and configure standard security headers including HSTS:
       ```ts
       app.use(helmet({
         hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
       }));
       ```
    2. Add an Express middleware in `src/main.ts` for production environments:
       ```ts
       if (process.env.NODE_ENV === 'production') {
         app.use((req, res, next) => {
           if (req.headers['x-forwarded-proto'] !== 'https') {
             return res.redirect(301, `https://${req.headers.host}${req.url}`);
           }
           next();
         });
       }
       ```

---

### 2. Sensitive Fields in `schema.prisma`
The following models and fields store sensitive data:

| Model | Field | Type | Current Protection | Notes & Risks |
|---|---|---|---|---|
| `User` | `passwordHash` | `String` | Bcrypt (10 rounds) | Non-reversible, salted per hash. Excluded from serialization via `@Exclude()` in `UserEntity`. |
| `User` | `transactionPinHash` | `String?` | Bcrypt (10 rounds) | Non-reversible, salted per hash. Excluded from serialization via `@Exclude()` in `UserEntity`. |
| `User` | `phone` | `String` (Unique) | Plaintext | Primary authentication identifier / PII. Required in plaintext for indexing and lookups. |
| `User` | `email` | `String?` (Unique) | Plaintext | PII. Required in plaintext for lookups and email delivery. |
| `User` | `firstName`, `lastName`, `dateOfBirth` | Various | Plaintext | Standard PII. |
| `PasswordResetSession` | `otpHash` | `String?` | Bcrypt (10 rounds) | Hashed 6-digit numeric OTP. 10-minute expiry and 5-attempt limit mitigate brute force. |
| `PasswordResetSession` | `emailTokenHash` | `String?` | Bcrypt (10 rounds) | Hashed 64-byte CSPRNG token (high entropy, resistant to offline search). |
| `MerchantOwnerProfile` | `idDocumentNumber` | `String?` | Plaintext | **Government ID / Passport / Driver's License number.** High sensitivity. Should consider column-level encryption. |
| `MerchantOwnerProfile` | `idDocumentUrl` | `String?` | Plaintext | Storage URL to government ID image. If stored as a public bucket URL, document is exposed if URL is leaked. Should use signed private URLs. |
| `Business` | `registrationNumber` | `String?` | Plaintext | Commercial registration number. |
| `Business` | `taxId` | `String?` | Plaintext | Corporate Tax ID. High sensitivity. |
| `Business` | `registrationDocumentUrl` | `String?` | Plaintext | Storage URL to corporate registration document. Same signed URL consideration as ID documents. |
| `AuditLog` | `metadata` | `Json?` | Plaintext JSON | Must never store sensitive request payloads (passwords, PINs, auth tokens). |

---

### 3. Password Hashing Algorithm & Cost Factor
- **Algorithm:** `bcrypt` (via `bcrypt` npm package).
- **Cost Factor:** `BCRYPT_ROUNDS = 10` uniformly used across:
  - `src/auth/auth.service.ts` (passwords & transaction PINs)
  - `src/users/users.service.ts` (transaction PIN updates)
  - `src/auth/password-reset.service.ts` (password resets & session OTPs)
  - `src/auth/otp.service.ts` (phone verification OTPs in Redis)
  - `src/auth/email-otp.service.ts` (email verification OTPs in Redis)
- **Evaluation:**
  - **Bcrypt with 10 rounds** meets OWASP recommendations (minimum work factor of 10). Each hash calculation takes ~80–120ms on standard cloud CPUs, providing strong brute-force resistance without causing event-loop denial of service.
  - Salt is cryptographically random and unique per hash.
  - Reversible encryption is not used for passwords, PINs, or OTPs.

---

### 4. Logging Hygiene & Plaintext Credential Search
A scan of `console.log`, `console.error`, and NestJS `Logger` calls revealed sensitive values logged in plaintext:

#### ⚠️ Plaintext Credentials in Logs (SEC-03)
1. **`src/notifications/sms.service.ts`**
   - **Line 110–112:** When Africa's Talking is not configured (or in stub mode), the service logs:
     ```ts
     this.logger.log(`[OTP STUB - ${flowLabel}] To: ${phone} | Code: ${code} | Message: ${message}`);
     ```
   - **Line 156–158:** When an SMS send error occurs, a fallback logger catches the exception and logs:
     ```ts
     this.logger.warn(`[OTP FALLBACK - ${flowLabel}] To: ${phone} | Code: ${code} | (Delivery failed, logged to console to prevent blocking flow)`);
     ```
     *Risk:* If SMS delivery fails in production (e.g. invalid sender ID, network glitch, low balance), the plaintext OTP is emitted to Railway deployment logs. Anyone with read access to Railway dashboard/logs can capture the active verification code.
   - **Lines 167 & 182:** `[SMS STUB]` and `[SMS FALLBACK]` log raw message contents (which may include password reset notices or codes).

2. **`src/notifications/whatsapp.service.ts`**
   - **Lines 62 & 78:** `[WHATSAPP STUB]` and `[WHATSAPP FALLBACK]` log `To: ${phone} | Message: ${message}`, where `message` contains the raw OTP or password reset link.

3. **`src/lib/mail/mail.service.ts`**
   - **Line 51–53:** When `RESEND_API_KEY` is not set or set to `'dev'`, the service logs:
     ```ts
     this.logger.log(`[MAIL STUB] To: ${to} | Subject: ${subject} | Body: ${text}`);
     ```
     *Risk:* Logs email OTPs and password reset links containing the raw 64-byte `resetToken`.

#### Safe Logging Verifications
- `src/auth/password-reset.service.ts`: Logs only user phone/email on error notification delivery failure; does not log tokens or passwords.
- `src/lib/audit-log/audit-log.service.ts`: Logs actor ID, action, and target ID; does not log request bodies.
- `src/lib/database/prisma/prisma.service.ts`: Logs only connection lifecycle events (`Database connection established`).

---

### 5. Secrets and Environment Variable Handling
- **`JWT_SECRET`:** Loaded exclusively via `config.getOrThrow<string>('JWT_SECRET')` in `src/auth/auth.module.ts` and `src/auth/strategies/jwt.strategy.ts`. The application fails to boot if this variable is missing.
- **Other Secrets:**
  - `DATABASE_URL`: Injected into `@prisma/adapter-pg` via `process.env.DATABASE_URL`.
  - `REDIS_URL`: Read via `config.getOrThrow<string>('REDIS_URL')`.
  - `RESEND_API_KEY`: Read via `process.env['RESEND_API_KEY']`.
  - `AT_API_KEY`, `AT_USERNAME`: Read via `process.env`.
- **Test / Seed Files:**
  - Unit tests use synthetic fixtures (`'1234567890abcdef1234567890abcdef'`, `'valid-production-api-key-1234567890'`).
  - E2E tests (`test/auth.e2e-spec.ts`) use `'e2e-test-secret'`.
  - No real credentials exist in test or seed files.

---

## PART 2 — Guard Coverage & Access Control Audit

### 6. Controller Route Guard Matrix

Every route in the application was inventoried and audited for guard coverage:

| Method | Route | Controller | Guards Applied | Access Level | Status / Finding |
|---|---|---|---|---|---|
| `GET` | `/` | `AppController` | None | Public | ✅ Intentionally public root endpoint |
| `GET` | `/health` | `AppController` | None (`@SkipThrottle`) | Public | ✅ Intentionally public health probe |
| `POST` | `/auth/otp/send` | `AuthController` | None (`@Throttle`) | Public | ✅ Intentionally public (pre-auth) |
| `POST` | `/auth/register` | `AuthController` | None | Public | ✅ Intentionally public (requires OTP) |
| `POST` | `/auth/admin/register` | `AuthController` | None | **PUBLIC (UNRESTRICTED)** | 🔴 **HIGH SEVERITY (SEC-01): Admin self-registration flaw** |
| `POST` | `/auth/merchant/register` | `AuthController` | None | Public | ✅ Public merchant self-registration (KYC starts PENDING) |
| `POST` | `/auth/login` | `AuthController` | None (`@Throttle`) | Public | ✅ Intentionally public (credentials required) |
| `GET` | `/auth/me` | `AuthController` | `JwtAuthGuard` | Authenticated | ✅ Protected, scoped to JWT user |
| `POST` | `/auth/logout` | `AuthController` | `JwtAuthGuard` | Authenticated | ✅ Protected, revokes token |
| `POST` | `/auth/email/verify` | `AuthController` | `JwtAuthGuard` | Authenticated | ✅ Protected, scoped to JWT user |
| `POST` | `/auth/password-reset/initiate` | `AuthController` | None (`@Throttle`) | Public | ✅ Intentionally public (anti-enumeration) |
| `POST` | `/auth/password-reset/method` | `AuthController` | None (`@Throttle`) | Public | ✅ Intentionally public |
| `POST` | `/auth/password-reset/verify-otp` | `AuthController` | None (`@Throttle`) | Public | ✅ Intentionally public (locked after 5 attempts) |
| `GET` | `/auth/password-reset/email/verify` | `AuthController` | None | Public | ✅ Intentionally public (email link validation) |
| `POST` | `/auth/password-reset/complete` | `AuthController` | None (`@Throttle`) | Public | ✅ Intentionally public (single-use token required) |
| `GET` | `/users` | `UsersController` | `JwtAuthGuard`, `AdminGuard` | Admin only | ✅ Role verified (`ADMIN` required) |
| `GET` | `/users/:id` | `UsersController` | `JwtAuthGuard`, `UserAccessGuard` | Self or Admin | ✅ Ownership verified (`user.id === id \|\| ADMIN`) |
| `PATCH` | `/users/:id` | `UsersController` | `JwtAuthGuard`, `UserAccessGuard` | Self or Admin | ✅ Ownership verified (`user.id === id \|\| ADMIN`) |
| `DELETE` | `/users/:id` | `UsersController` | `JwtAuthGuard`, `UserAccessGuard` | Self or Admin | ✅ Ownership verified (`user.id === id \|\| ADMIN`) |
| `POST` | `/merchants/businesses` | `MerchantController` | `JwtAuthGuard`, `MerchantGuard` | Merchant only | ✅ Scoped to `user.id` + KYC VERIFIED check |
| `GET` | `/merchants/businesses` | `MerchantController` | `JwtAuthGuard`, `MerchantGuard` | Merchant only | ✅ Scoped to `ownerId === user.id` |
| `GET` | `/merchants/profile` | `MerchantController` | `JwtAuthGuard`, `MerchantGuard` | Merchant only | ✅ Scoped to `userId === user.id` |

---

### 7. Role Verification on Admin & Merchant Routes
- **`AdminGuard` Implementation (`src/common/guards/admin.guard.ts`):**
  ```ts
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user: RequestUser }>();
    if (req.user?.role !== Role.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
  ```
  - **Verification:** Correctly checks `req.user.role === Role.ADMIN`.
  - A user with `Role.MERCHANT` or `Role.USER` attempting to access `GET /users` is rejected with `403 Forbidden: 'Admin access required'`.
- **`MerchantGuard` Implementation (`src/common/guards/merchant.guard.ts`):**
  ```ts
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user: RequestUser }>();
    if (req.user?.role !== Role.MERCHANT) {
      throw new ForbiddenException('Merchant access required');
    }
    return true;
  }
  ```
  - **Verification:** Correctly checks `req.user.role === Role.MERCHANT`.
  - An `ADMIN` or regular `USER` attempting to access `/merchants/*` is rejected with `403 Forbidden: 'Merchant access required'`.
- **JWT Strategy Freshness (`src/auth/strategies/jwt.strategy.ts`):**
  - On every authenticated request, `JwtStrategy.validate` queries the database via `prisma.db.user.findUnique` for the user's current role.
  - If a user's role is revoked in the database, the change takes effect **immediately** on the next request without waiting for the JWT to expire.
  - Deleted users are immediately rejected (`401 Unauthorized: 'User no longer exists'`).

---

### 8. Ownership & Scoping Verification
- **Merchant Resource Scoping (`MerchantController`):**
  - `POST /merchants/businesses`: Reads `user.id` from `@CurrentUser()`. Cannot specify a different owner.
  - `GET /merchants/businesses`: Queries `where: { ownerId: user.id }`.
  - `GET /merchants/profile`: Queries `where: { userId: user.id }`.
  - **Result:** Merchant A **cannot** view or alter Merchant B's business data because no endpoint accepts arbitrary owner IDs.
- **User Resource Scoping (`UsersController`):**
  - Routes `GET /users/:id`, `PATCH /users/:id`, and `DELETE /users/:id` use `UserAccessGuard`:
    ```ts
    if (user?.role === Role.ADMIN || user?.id === paramId) {
      return true;
    }
    throw new ForbiddenException('Access denied');
    ```
  - If User A guesses User B's UUID, `user.id === paramId` is false and `user.role === Role.ADMIN` is false, returning `403 Forbidden: 'Access denied'`.
  - **Defensive Observation (SEC-06):** In JavaScript, if `user?.id` is undefined and `paramId` is undefined, `undefined === undefined` evaluates to `true`. While `JwtAuthGuard` ensures `user.id` is populated and `ParseUUIDPipe` ensures `paramId` is a non-empty UUID, `UserAccessGuard` should defensively enforce:
    ```ts
    const isOwner = Boolean(user?.id && paramId && user.id === paramId);
    if (user?.role === Role.ADMIN || isOwner) {
      return true;
    }
    ```

---

## Detailed Findings & Actionable Recommendations

### 🔴 Finding SEC-01: Publicly Accessible Admin Registration (HIGH)
- **Location:** `src/auth/auth.controller.ts` line 61 (`POST /auth/admin/register`), `src/auth/auth.service.ts` line 103.
- **Description:** Anyone with a working phone number can complete an SMS OTP verification and call `POST /auth/admin/register` to create an administrator account with arbitrary `permissionsLevel`.
- **Impact:** Immediate total privilege escalation; unauthorized administrative access to all user profiles, audit logs, and system features.
- **Remediation Options (For Review):**
  1. **Option A (Recommended):** Restrict `POST /auth/admin/register` behind `JwtAuthGuard` + `AdminGuard` so only existing administrators can provision new administrators.
  2. **Option B:** Protect the endpoint with an environment-based shared secret header (e.g. `x-admin-enrollment-secret: process.env.ADMIN_ENROLLMENT_SECRET`).
  3. **Option C:** Disable the endpoint in production and seed initial administrators via a protected CLI / migration script.

---

### 🔴 Finding SEC-02: Missing HTTPS Redirection & Security Headers (HIGH)
- **Location:** `src/main.ts`
- **Description:** Railway terminates TLS, but the application does not redirect incoming HTTP requests or set HSTS headers.
- **Impact:** Vulnerability to SSL stripping (MitM) if clients initiate requests over plaintext HTTP.
- **Remediation:**
  1. Add `helmet` package to `package.json`.
  2. Configure `helmet()` and HTTP redirection middleware in `src/main.ts` based on `x-forwarded-proto`.

---

### 🟡 Finding SEC-03: Plaintext OTP and Token Logging (MEDIUM)
- **Location:**
  - `src/notifications/sms.service.ts` (lines 110–112, 156–158)
  - `src/notifications/whatsapp.service.ts` (lines 62, 78)
  - `src/lib/mail/mail.service.ts` (lines 51–53)
- **Description:** When third-party services are unconfigured, or when SMS delivery fails, raw OTPs and reset tokens are written to standard output (`this.logger.log` / `this.logger.warn`).
- **Impact:** Cloud deployment log sinks retain plaintext OTPs and reset tokens, allowing anyone with log viewing privileges to bypass multi-factor authentication or hijack reset sessions.
- **Remediation:**
  1. Mask or suppress the OTP/token when `NODE_ENV === 'production'`:
     ```ts
     const displayCode = process.env.NODE_ENV === 'production' ? '******' : code;
     ```
  2. In fallback scenarios, log only that delivery failed and that an error was recorded — do not log the code itself to console in production.

---

### 🟡 Finding SEC-04: Plaintext Storage of KYC Documents & Tax IDs (MEDIUM)
- **Location:** `prisma/schema.prisma` (`MerchantOwnerProfile.idDocumentNumber`, `Business.taxId`, `idDocumentUrl`)
- **Description:** Identity document numbers and tax identifiers are stored as plaintext strings in Supabase Postgres.
- **Impact:** In the event of a database snapshot leak or unauthorized read access, personal identity numbers and tax records are readable without decryption.
- **Remediation:**
  1. Implement application-level encryption (e.g., AES-256-GCM via a dedicated cryptographic service) before writing `idDocumentNumber` and `taxId` to the database.
  2. Ensure `idDocumentUrl` points to private storage buckets requiring short-lived presigned URLs for access.

---

### 🟡 Finding SEC-05: In-Memory Token Blacklist Store (MEDIUM)
- **Location:** `src/lib/token-blacklist/token-blacklist.service.ts`
- **Description:** Token blacklist uses an in-memory `Map`.
- **Impact:** When deployed with multiple container replicas on Railway, a token revoked on Container A is not recognized as revoked on Container B. Furthermore, any deployment or container restart clears the blacklist, restoring validity to all logged-out tokens.
- **Remediation:**
  - Migrate `TokenBlacklistService` to use the existing `REDIS_CLIENT` (`ioredis`), setting the blacklisted token with an expiry matching the JWT's remaining TTL (`SET token "1" EX ttlSeconds`).

# Moani Backend — API Testing Guide & Test Data

Comprehensive test suites, payloads, and step-by-step verification flows for testing the Moani/Finda backend deployed on Railway (or locally).

---

## 1. Environment & Setup

Export your Railway app URL and credentials in your terminal:

```bash
# Set your Railway deployment URL (no trailing slash)
export BASE_URL="https://moani-backend-production.up.railway.app"

# Existing test user pre-seeded in Supabase
export USER_ID="bd9c41d5-dec1-4fe9-958a-c6b75f90cf04"
export USER_PHONE="+237691234567"
export USER_EMAIL="amara.fon@example.com"
```

> [!NOTE]
> **OTP Delivery in Stub Mode**:  
> Until third-party SMS (Africa's Talking) and Email (Resend) API keys are connected, the app runs in **console stub mode**. All OTP codes and verification links are printed in real-time to your **Railway Deployment Logs** (`Deployments` → `View Logs`):
> - SMS OTP log: `[SMS STUB] To: +237... | Message: ... code is: 123456.`
> - Email OTP log: `[MAIL STUB] To: ... | Subject: ... | Body: ... code is: 654321.`

---

## 2. Seeded & Synthetic Test Data Reference

### Existing Seeded Account (Supabase)
| Field | Value | Notes |
| :--- | :--- | :--- |
| **`id`** | `bd9c41d5-dec1-4fe9-958a-c6b75f90cf04` | UUID Primary Key |
| **`phone`** | `+237691234567` | Cameroon MTN prefix (`+23769...`) |
| **`firstName`** | `Amara` | |
| **`lastName`** | `Fon` | |
| **`email`** | `amara.fon@example.com` | Unverified by default |
| **`role`** | `USER` | |
| **`isPhoneVerified`** | `true` | |
| **`isEmailVerified`** | `false` | Becomes `true` after `/auth/email/verify` |
| **`dateOfBirth`** | `1995-06-15T00:00:00.000Z` | ≥ 18 years old requirement satisfied |

### New Account Candidate (for Registration tests)
| Field | Value | Notes |
| :--- | :--- | :--- |
| **`phone`** | `+237691234568` | Unique Cameroon phone |
| **`firstName`** | `Samuel` | |
| **`lastName`** | `Eto'o` | |
| **`email`** | `samuel.etoo@moani.cm` | |
| **`password`** | `SecurePass2026!` | 1 lowercase, 1 uppercase, 1 digit, ≥ 8 chars |
| **`dateOfBirth`** | `1990-03-10` | ISO 8601 string |
| **`transactionPin`** | `1234` | 4 to 6 digits |

---

## 3. Test Flow 1: Password Reset (Verifying `ResetMethod` Enum Fix)

This flow validates the `ResetMethod` enum fix (`OTP` / `EMAIL_LINK`) in PostgreSQL and updates the password for Amara Fon.

### Step 1.1: Initiate Password Reset
```bash
curl -i -s -X POST "$BASE_URL/auth/password-reset/initiate" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "'"$USER_PHONE"'"
  }'
```
- **Expected Status**: `200 OK`
- **Expected Response**:
  ```json
  {
    "resetSessionId": "eyJhbGciOi..."
  }
  ```
- **Save session ID**:
  ```bash
  export RESET_SESSION_ID="<paste_resetSessionId_here>"
  ```

---

### Step 1.2: Choose Reset Method (`ResetMethod.OTP`)
> This endpoint previously failed with `type "public.ResetMethod" does not exist`. It now succeeds!

```bash
curl -i -s -X POST "$BASE_URL/auth/password-reset/method" \
  -H "Content-Type: application/json" \
  -d '{
    "resetSessionId": "'"$RESET_SESSION_ID"'",
    "method": "OTP"
  }'
```
- **Expected Status**: `200 OK`
- **Expected Response**:
  ```json
  {
    "message": "If eligible, we've sent a code/link."
  }
  ```
- **Action**: Check Railway deployment logs for the 6-digit code:
  `Your Moani password reset code is: XXXXXX. It expires in 10 minutes.`

---

### Step 1.3: Verify Reset OTP
```bash
curl -i -s -X POST "$BASE_URL/auth/password-reset/verify-otp" \
  -H "Content-Type: application/json" \
  -d '{
    "resetSessionId": "'"$RESET_SESSION_ID"'",
    "otp": "<REPLACE_WITH_OTP_FROM_LOGS>"
  }'
```
- **Expected Status**: `200 OK`
- **Expected Response**:
  ```json
  {
    "resetToken": "eyJhbGciOi..."
  }
  ```
- **Save reset token**:
  ```bash
  export RESET_TOKEN="<paste_resetToken_here>"
  ```

---

### Step 1.4: Complete Password Reset
Set a known password (e.g. `MoaniTest2026!`):

```bash
curl -i -s -X POST "$BASE_URL/auth/password-reset/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "resetToken": "'"$RESET_TOKEN"'",
    "newPassword": "MoaniTest2026!",
    "confirmPassword": "MoaniTest2026!"
  }'
```
- **Expected Status**: `200 OK`
- **Expected Response**:
  ```json
  {
    "message": "Password updated successfully. You can now log in with your new password."
  }
  ```

---

### Step 1.5: Verify Token Consumption (Replay Prevention)
Try submitting the same reset token a second time:
```bash
curl -i -s -X POST "$BASE_URL/auth/password-reset/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "resetToken": "'"$RESET_TOKEN"'",
    "newPassword": "MoaniTest2026!",
    "confirmPassword": "MoaniTest2026!"
  }'
```
- **Expected Status**: `401 Unauthorized`
- **Expected Message**: `Reset token is invalid or has expired. Please start over.`

---

## 4. Test Flow 2: Authentication & Profile Operations

### Step 2.1: Login with New Password
```bash
curl -i -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "'"$USER_PHONE"'",
    "password": "MoaniTest2026!"
  }'
```
- **Expected Status**: `200 OK`
- **Expected Response**:
  ```json
  {
    "accessToken": "eyJhbGciOi...",
    "user": {
      "id": "bd9c41d5-dec1-4fe9-958a-c6b75f90cf04",
      "phone": "+237691234567",
      "firstName": "Amara",
      "lastName": "Fon",
      "role": "USER",
      "isPhoneVerified": true,
      "isEmailVerified": false
    }
  }
  ```
- **Save JWT token**:
  ```bash
  export AUTH_TOKEN="<paste_accessToken_here>"
  ```

---

### Step 2.2: Fetch Authenticated User (`GET /auth/me`)
```bash
curl -i -s -X GET "$BASE_URL/auth/me" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```
- **Expected Status**: `200 OK`
- **Expected**: Matches Amara Fon's profile data (`passwordHash` and `transactionPinHash` excluded).

---

### Step 2.3: Self Profile Access (`GET /users/:id`)
```bash
curl -i -s -X GET "$BASE_URL/users/$USER_ID" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```
- **Expected Status**: `200 OK`

---

### Step 2.4: Cross-User Access Guard (`UserAccessGuard`)
Attempt to access a different user's resource using Amara's token:
```bash
curl -i -s -X GET "$BASE_URL/users/00000000-0000-0000-0000-000000000001" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```
- **Expected Status**: `403 Forbidden`

---

### Step 2.5: Update Profile & Trigger Email Verification (`PATCH /users/:id`)
Update the email to trigger a verification OTP:
```bash
curl -i -s -X PATCH "$BASE_URL/users/$USER_ID" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Amara",
    "lastName": "Fon",
    "email": "amara.verified@moani.cm"
  }'
```
- **Expected Status**: `200 OK`
- **Expected**: `isEmailVerified: false`
- **Action**: Check Railway deployment logs for:
  `[MAIL STUB] To: amara.verified@moani.cm | Subject: Verify your email address | Body: Your Moani email verification code is: XXXXXX.`

---

### Step 2.6: Confirm Email Verification (`POST /auth/email/verify`)
```bash
curl -i -s -X POST "$BASE_URL/auth/email/verify" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "otp": "<REPLACE_WITH_EMAIL_OTP_FROM_LOGS>"
  }'
```
- **Expected Status**: `200 OK`
- **Expected Response**: `{"message": "Email address verified successfully."}`
- **Confirmation**: Running `GET $BASE_URL/auth/me` now shows `"isEmailVerified": true`.

---

### Step 2.7: Logout & In-Memory Token Blacklist
```bash
curl -i -s -X POST "$BASE_URL/auth/logout" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```
- **Expected Status**: `200 OK`
- **Expected Response**: `{"message": "Successfully logged out"}`

Verify the revoked token is immediately rejected:
```bash
curl -i -s -X GET "$BASE_URL/auth/me" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```
- **Expected Status**: `401 Unauthorized`

---

## 5. Test Flow 3: Email-Link Password Reset (`ResetMethod.EMAIL_LINK`)

Once an email is verified (`isEmailVerified: true`), test the second branch of the `ResetMethod` enum.

### Step 3.1: Initiate Reset
```bash
curl -i -s -X POST "$BASE_URL/auth/password-reset/initiate" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "'"$USER_PHONE"'"
  }'
```
- Save the returned `resetSessionId`:
  ```bash
  export EMAIL_RESET_SESSION="<paste_resetSessionId_here>"
  ```

### Step 3.2: Choose `EMAIL_LINK` Method
```bash
curl -i -s -X POST "$BASE_URL/auth/password-reset/method" \
  -H "Content-Type: application/json" \
  -d '{
    "resetSessionId": "'"$EMAIL_RESET_SESSION"'",
    "method": "EMAIL_LINK"
  }'
```
- **Expected Status**: `200 OK`
- **Action**: Check Railway deployment logs for the reset link:
  `[MAIL STUB] ... /reset-password/email?token=<HEX_TOKEN>&sessionId=<SESSION_UUID>`

### Step 3.3: Verify Email Link Token
```bash
curl -i -s -X GET "$BASE_URL/auth/password-reset/email/verify?sessionId=<SESSION_UUID>&token=<HEX_TOKEN>"
```
- **Expected Status**: `200 OK`
- **Expected Response**: Returns `{ "resetToken": "eyJhbGciOi..." }`, which can be submitted to `/auth/password-reset/complete`.

---

## 6. Test Flow 4: Registration & Duplicate Conflict Checks

### Step 4.1: Test Unique Phone Constraint Guard
Attempt to register with Amara's already existing phone number:
```bash
curl -i -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "'"$USER_PHONE"'",
    "otp": "123456",
    "firstName": "Duplicate",
    "lastName": "User",
    "password": "Password123!",
    "dateOfBirth": "1995-01-01",
    "transactionPin": "1234"
  }'
```
- **Expected Status**: `409 Conflict` (or `401 Invalid OTP` if OTP checked first).

---

### Step 4.2: Send OTP for New Phone
```bash
curl -i -s -X POST "$BASE_URL/auth/otp/send" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+237691234568",
    "channel": "sms"
  }'
```
- **Expected Status**: `200 OK`
- **Action**: Note the 6-digit OTP in Railway deployment logs.

---

### Step 4.3: Complete Registration
```bash
curl -i -s -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+237691234568",
    "otp": "<REPLACE_WITH_OTP_FROM_LOGS>",
    "firstName": "Samuel",
    "lastName": "Etoo",
    "email": "samuel.etoo@moani.cm",
    "password": "SecurePassword2026!",
    "dateOfBirth": "1990-03-10",
    "transactionPin": "9876"
  }'
```
- **Expected Status**: `201 Created`
- **Expected Response**: Returns `{ "accessToken": "...", "user": { ... } }`.

---

## 7. Test Flow 5: Infrastructure & Admin Guards

### Step 5.1: Health Check (`GET /health`)
```bash
curl -i -s -X GET "$BASE_URL/health"
```
- **Expected Status**: `200 OK`
- **Body**: `{"status": "ok", "timestamp": "..."}`

---

### Step 5.2: Admin Route Guard (`GET /users`)
Attempt to list all users using a standard user token:
```bash
curl -i -s -X GET "$BASE_URL/users" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```
- **Expected Status**: `403 Forbidden` (`AdminGuard` working as intended).

---

## 8. Quick Verification Matrix

| Endpoint | Method | Key Test Case | Expected Code |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | Container liveness check | `200` |
| `/auth/password-reset/initiate` | `POST` | Start reset session | `200` |
| `/auth/password-reset/method` | `POST` | Choose `ResetMethod.OTP` | `200` |
| `/auth/password-reset/method` | `POST` | Choose `ResetMethod.EMAIL_LINK` | `200` |
| `/auth/password-reset/verify-otp` | `POST` | Validate 6-digit OTP | `200` |
| `/auth/password-reset/complete` | `POST` | Apply new password | `200` |
| `/auth/login` | `POST` | Login with newly reset password | `200` |
| `/auth/me` | `GET` | Authenticated profile retrieval | `200` |
| `/users/:id` | `GET` | Self profile access | `200` |
| `/users/:id` | `GET` | Foreign profile access | `403` |
| `/users/:id` | `PATCH` | Update email (triggers OTP) | `200` |
| `/auth/email/verify` | `POST` | Confirm email ownership | `200` |
| `/auth/logout` | `POST` | Revoke active JWT | `200` |
| `/auth/me` | `GET` | Replay revoked JWT | `401` |
| `/auth/otp/send` | `POST` | Request phone OTP | `200` |
| `/auth/register` | `POST` | Register new user with OTP | `201` |
| `/users` | `GET` | Non-admin listing users | `403` |

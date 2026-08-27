-- CreateEnum
CREATE TYPE "reset_method" AS ENUM ('OTP', 'EMAIL_LINK');

-- CreateTable
CREATE TABLE "password_reset_sessions" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "method"         "reset_method",
    "otpHash"        TEXT,
    "emailTokenHash" TEXT,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    "usedAt"         TIMESTAMP(3),
    "attempts"       INTEGER NOT NULL DEFAULT 0,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_sessions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "password_reset_sessions"
    ADD CONSTRAINT "password_reset_sessions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

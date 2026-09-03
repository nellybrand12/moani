/*
  Warnings:

  - The `method` column on the `password_reset_sessions` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `phone_otps` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ResetMethod" AS ENUM ('OTP', 'EMAIL_LINK');

-- AlterTable
ALTER TABLE "password_reset_sessions" DROP COLUMN "method",
ADD COLUMN     "method" "ResetMethod";

-- DropTable
DROP TABLE "phone_otps";

-- DropEnum
DROP TYPE "reset_method";

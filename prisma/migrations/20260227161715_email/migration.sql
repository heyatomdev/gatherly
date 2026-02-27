-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "emailActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "webhookUrl" TEXT;

-- AlterTable
ALTER TABLE "participants" ADD COLUMN     "email" TEXT;

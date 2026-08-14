/*
  Warnings:

  - You are about to drop the column `name` on the `event_categories` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `isRecurring` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `recurrenceCount` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `recurrenceEndDate` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `recurrenceId` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `recurrenceRule` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `tags` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `events` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `participants` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[eventId,externalId,externalSource]` on the table `participants` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ParticipantType" AS ENUM ('INLINE', 'EXTERNAL');

-- DropIndex
DROP INDEX "event_categories_clientId_name_key";

-- DropIndex
DROP INDEX "participants_eventId_userId_key";

-- DropIndex
DROP INDEX "participants_userId_idx";

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "defaultLocale" TEXT NOT NULL DEFAULT 'it';

-- AlterTable
ALTER TABLE "event_categories" DROP COLUMN "name";

-- AlterTable
ALTER TABLE "events" DROP COLUMN "description",
DROP COLUMN "isRecurring",
DROP COLUMN "recurrenceCount",
DROP COLUMN "recurrenceEndDate",
DROP COLUMN "recurrenceId",
DROP COLUMN "recurrenceRule",
DROP COLUMN "tags",
DROP COLUMN "title",
ADD COLUMN     "defaultLocale" TEXT NOT NULL DEFAULT 'it',
ADD COLUMN     "recurrenceRuleId" TEXT;

-- AlterTable
ALTER TABLE "participants" DROP COLUMN "userId",
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "type" "ParticipantType" NOT NULL DEFAULT 'INLINE';

-- CreateTable
CREATE TABLE "event_category_translations" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "event_category_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurrence_rules" (
    "id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "endDate" TIMESTAMP(3),
    "count" INTEGER,

    CONSTRAINT "recurrence_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_translations" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "event_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" JSONB,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_tags" (
    "eventId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "event_tags_pkey" PRIMARY KEY ("eventId","tagId")
);

-- CreateIndex
CREATE INDEX "event_category_translations_locale_idx" ON "event_category_translations"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "event_category_translations_categoryId_locale_key" ON "event_category_translations"("categoryId", "locale");

-- CreateIndex
CREATE INDEX "event_translations_eventId_idx" ON "event_translations"("eventId");

-- CreateIndex
CREATE INDEX "event_translations_locale_idx" ON "event_translations"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "event_translations_eventId_locale_key" ON "event_translations"("eventId", "locale");

-- CreateIndex
CREATE INDEX "tags_clientId_idx" ON "tags"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_clientId_slug_key" ON "tags"("clientId", "slug");

-- CreateIndex
CREATE INDEX "participants_externalId_idx" ON "participants"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "participants_eventId_externalId_externalSource_key" ON "participants"("eventId", "externalId", "externalSource");

-- AddForeignKey
ALTER TABLE "event_category_translations" ADD CONSTRAINT "event_category_translations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "event_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_recurrenceRuleId_fkey" FOREIGN KEY ("recurrenceRuleId") REFERENCES "recurrence_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_translations" ADD CONSTRAINT "event_translations_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

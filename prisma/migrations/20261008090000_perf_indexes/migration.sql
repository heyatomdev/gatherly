-- Redundant: covered by the leftmost column of a composite/unique index.
DROP INDEX "events_clientId_idx";
DROP INDEX "event_translations_eventId_idx";
DROP INDEX "tags_clientId_idx";

-- Participant: one composite for "participants of event X by status, oldest first"
-- (capacity counts, waitlist promotion, paginated list).
DROP INDEX "participants_eventId_idx";
DROP INDEX "participants_status_idx";
CREATE INDEX "participants_eventId_status_createdAt_idx" ON "participants"("eventId", "status", "createdAt");

DROP INDEX "participants_externalId_idx";
CREATE INDEX "participants_externalId_externalSource_idx" ON "participants"("externalId", "externalSource");

-- People/analytics match on lower(trim(email)); a plain btree on email is never used.
DROP INDEX "participants_email_idx";
CREATE INDEX "participants_email_norm_idx" ON "participants"(lower(trim("email")));

-- Tag -> events lookups (GET /tags/:id/events, tag filter on GET /events).
CREATE INDEX "event_tags_tagId_idx" ON "event_tags"("tagId");

-- Delivery history per client, newest first.
DROP INDEX "webhook_deliveries_clientId_idx";
CREATE INDEX "webhook_deliveries_clientId_createdAt_idx" ON "webhook_deliveries"("clientId", "createdAt");

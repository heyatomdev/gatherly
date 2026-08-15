-- CreateIndex
CREATE INDEX "events_clientId_startTime_idx" ON "events"("clientId", "startTime");

-- CreateIndex
CREATE INDEX "participants_email_idx" ON "participants"("email");

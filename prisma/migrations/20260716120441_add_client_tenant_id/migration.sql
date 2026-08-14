-- AlterTable
ALTER TABLE "clients" ADD COLUMN "tenantId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "clients_tenantId_key" ON "clients"("tenantId");

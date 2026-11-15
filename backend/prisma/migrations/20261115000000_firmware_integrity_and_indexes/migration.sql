-- AlterTable
ALTER TABLE "firmware" ADD COLUMN     "md5" TEXT,
ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "size" INTEGER;

-- CreateIndex
CREATE INDEX "firmware_name_version_idx" ON "firmware"("name", "version");

-- CreateIndex
CREATE INDEX "firmware_history_deviceId_status_idx" ON "firmware_history"("deviceId", "status");

-- CreateIndex
CREATE INDEX "firmware_history_status_appliedAt_idx" ON "firmware_history"("status", "appliedAt");

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "currentFirmwareId" TEXT;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_currentFirmwareId_fkey" FOREIGN KEY ("currentFirmwareId") REFERENCES "firmware"("id") ON DELETE SET NULL ON UPDATE CASCADE;

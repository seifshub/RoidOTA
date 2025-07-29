-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'TIMEOUT');

-- AlterTable
ALTER TABLE "firmware_history" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "status" "DeploymentStatus" NOT NULL DEFAULT 'PENDING';

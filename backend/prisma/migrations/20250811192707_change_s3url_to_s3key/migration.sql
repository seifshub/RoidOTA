/*
  Warnings:

  - You are about to rename the column `s3Url` to `s3Key` on the `firmware` table.

*/
-- AlterTable
ALTER TABLE "firmware" RENAME COLUMN "s3Url" TO "s3Key";

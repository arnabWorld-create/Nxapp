-- AlterTable
ALTER TABLE "Import" ADD COLUMN     "failed_at" TIMESTAMP(3),
ADD COLUMN     "failure_message" TEXT,
ADD COLUMN     "failure_stage" TEXT;

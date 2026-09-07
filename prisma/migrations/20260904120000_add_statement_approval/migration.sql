ALTER TABLE "Statement" ADD COLUMN "approved_by" TEXT;
ALTER TABLE "Statement" ADD COLUMN "approved_at" TIMESTAMP(3);
ALTER TABLE "Statement" ADD COLUMN "approval_note" TEXT;

ALTER TABLE "Statement"
ADD CONSTRAINT "Statement_approved_by_fkey"
FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
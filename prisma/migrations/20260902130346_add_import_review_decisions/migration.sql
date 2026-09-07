-- CreateEnum
CREATE TYPE "ImportRowType" AS ENUM ('DATA_ROW', 'SUMMARY_ROW', 'NON_DATA_ROW');

-- AlterTable
ALTER TABLE "Import" ADD COLUMN     "default_quantity_unit" TEXT,
ADD COLUMN     "default_quantity_unit_confirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "default_quantity_unit_confirmed_at" TIMESTAMP(3),
ADD COLUMN     "default_quantity_unit_confirmed_by" TEXT,
ADD COLUMN     "summary_rows_acknowledged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "summary_rows_acknowledged_at" TIMESTAMP(3),
ADD COLUMN     "summary_rows_acknowledged_by" TEXT;

-- AlterTable
ALTER TABLE "ImportRow" ADD COLUMN     "non_data_reason" TEXT,
ADD COLUMN     "row_type" "ImportRowType" NOT NULL DEFAULT 'DATA_ROW';

-- AddForeignKey
ALTER TABLE "Import" ADD CONSTRAINT "Import_default_quantity_unit_confirmed_by_fkey" FOREIGN KEY ("default_quantity_unit_confirmed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Import" ADD CONSTRAINT "Import_summary_rows_acknowledged_by_fkey" FOREIGN KEY ("summary_rows_acknowledged_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

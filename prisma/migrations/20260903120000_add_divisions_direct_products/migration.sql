-- CreateEnum
CREATE TYPE "DivisionStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- DropForeignKey
ALTER TABLE "StatementRow" DROP CONSTRAINT "StatementRow_product_id_brand_id_fkey";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "division_id" TEXT,
ALTER COLUMN "brand_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Division" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "code" TEXT,
    "status" "DivisionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Division_normalized_name_key" ON "Division"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_division_id_normalized_name_key" ON "Product"("division_id", "normalized_name");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "Division"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementRow" ADD CONSTRAINT "StatementRow_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
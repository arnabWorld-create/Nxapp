/*
  Warnings:

  - A unique constraint covering the columns `[id,brand_id]` on the table `Product` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,product_id]` on the table `ProductVariant` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "StatementRow" DROP CONSTRAINT "StatementRow_product_id_fkey";

-- DropForeignKey
ALTER TABLE "StatementRow" DROP CONSTRAINT "StatementRow_variant_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_brand_id_key" ON "Product"("id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_id_product_id_key" ON "ProductVariant"("id", "product_id");

-- AddForeignKey
ALTER TABLE "StatementRow" ADD CONSTRAINT "StatementRow_product_id_brand_id_fkey" FOREIGN KEY ("product_id", "brand_id") REFERENCES "Product"("id", "brand_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementRow" ADD CONSTRAINT "StatementRow_variant_id_product_id_fkey" FOREIGN KEY ("variant_id", "product_id") REFERENCES "ProductVariant"("id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

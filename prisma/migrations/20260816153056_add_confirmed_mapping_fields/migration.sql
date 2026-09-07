-- AlterTable
ALTER TABLE "ImportRow" ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_brand_id" TEXT,
ADD COLUMN     "confirmed_by_user_id" TEXT,
ADD COLUMN     "confirmed_product_id" TEXT,
ADD COLUMN     "confirmed_variant_id" TEXT,
ADD COLUMN     "match_reason" TEXT;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_confirmed_brand_id_fkey" FOREIGN KEY ("confirmed_brand_id") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_confirmed_product_id_fkey" FOREIGN KEY ("confirmed_product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_confirmed_variant_id_fkey" FOREIGN KEY ("confirmed_variant_id") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

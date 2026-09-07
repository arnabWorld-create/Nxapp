CREATE TABLE "LearnedMapping" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "normalized_source_name" TEXT NOT NULL,
    "entity_key" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "brand_id" TEXT,
    "product_id" TEXT,
    "variant_id" TEXT,
    "division_id" TEXT,
    "confirmed_by_user_id" TEXT,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearnedMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LearnedMapping_normalized_source_name_entity_key_key"
ON "LearnedMapping"("normalized_source_name", "entity_key");
CREATE INDEX "LearnedMapping_normalized_source_name_idx"
ON "LearnedMapping"("normalized_source_name");
ALTER TABLE "LearnedMapping" ADD CONSTRAINT "LearnedMapping_brand_id_fkey"
FOREIGN KEY ("brand_id") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearnedMapping" ADD CONSTRAINT "LearnedMapping_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearnedMapping" ADD CONSTRAINT "LearnedMapping_variant_id_fkey"
FOREIGN KEY ("variant_id") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearnedMapping" ADD CONSTRAINT "LearnedMapping_division_id_fkey"
FOREIGN KEY ("division_id") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearnedMapping" ADD CONSTRAINT "LearnedMapping_confirmed_by_user_id_fkey"
FOREIGN KEY ("confirmed_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
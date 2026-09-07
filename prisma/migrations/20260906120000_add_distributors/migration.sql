-- CreateEnum
CREATE TYPE "DistributorStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "Distributor" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "status" "DistributorStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "salesperson_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Distributor_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Statement" ADD COLUMN "distributor_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Distributor_normalized_name_key" ON "Distributor"("normalized_name");
CREATE INDEX "Distributor_salesperson_user_id_idx" ON "Distributor"("salesperson_user_id");
CREATE INDEX "Distributor_status_idx" ON "Distributor"("status");

-- AddForeignKey
ALTER TABLE "Distributor" ADD CONSTRAINT "Distributor_salesperson_user_id_fkey" FOREIGN KEY ("salesperson_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Statement" ADD CONSTRAINT "Statement_distributor_id_fkey" FOREIGN KEY ("distributor_id") REFERENCES "Distributor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
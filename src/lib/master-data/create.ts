import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import { normalizeText } from '../matching/utils';

export class MasterAlreadyExistsError extends Error {
  existingId?: string;
  constructor(message: string, existingId?: string) {
    super(message);
    this.name = 'MasterAlreadyExistsError';
    this.existingId = existingId;
  }
}

export class MasterParentNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MasterParentNotFoundError';
  }
}

export async function createDivision(input: { name: unknown; code?: unknown }) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new TypeError('Division name is required');
  const normalizedName = normalizeText(name);
  try {
    return await prisma.division.create({
      data: {
        name,
        normalized_name: normalizedName,
        code: typeof input.code === 'string' ? input.code.trim() || null : null,
      },
    });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const existing = await prisma.division.findUnique({ where: { normalized_name: normalizedName }, select: { id: true } });
      throw new MasterAlreadyExistsError('Division with this name already exists', existing?.id);
    }
    throw error;
  }
}

function isUniqueConflict(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function createBrand(input: { name: unknown; code?: unknown }) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new TypeError('Brand name is required');
  const normalizedName = normalizeText(name);
  try {
    return await prisma.brand.create({ data: { name, normalized_name: normalizedName, code: typeof input.code === 'string' ? input.code.trim() || null : null } });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const existing = await prisma.brand.findUnique({ where: { normalized_name: normalizedName }, select: { id: true } });
      throw new MasterAlreadyExistsError('Brand with this name already exists', existing?.id);
    }
    throw error;
  }
}

export async function createProduct(input: { name: unknown; code?: unknown; brandId?: unknown; divisionId?: unknown }) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new TypeError('Product name is required');
  const brandId = typeof input.brandId === 'string' && input.brandId ? input.brandId : null;
  const divisionId = typeof input.divisionId === 'string' && input.divisionId ? input.divisionId : null;
  if (!brandId && !divisionId) throw new TypeError('Division ID is required for a direct Master Medicine Item');
  if (brandId) {
    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) throw new MasterParentNotFoundError('Brand not found');
  }
  if (divisionId) {
    const division = await prisma.division.findUnique({ where: { id: divisionId }, select: { id: true } });
    if (!division) throw new MasterParentNotFoundError('Division not found');
  }
  const normalizedName = normalizeText(name);
  try {
    return await prisma.product.create({ data: { name, normalized_name: normalizedName, code: typeof input.code === 'string' ? input.code.trim() || null : null, brand_id: brandId ?? undefined, division_id: divisionId ?? undefined } });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const existing = await prisma.product.findFirst({
        where: {
          normalized_name: normalizedName,
          OR: [
            ...(brandId ? [{ brand_id: brandId }] : []),
            ...(divisionId ? [{ division_id: divisionId }] : []),
          ] as Prisma.ProductWhereInput[],
        },
        select: { id: true },
      });
      throw new MasterAlreadyExistsError('Product with this name already exists in the selected scope', existing?.id);
    }
    throw error;
  }
}

export async function createVariant(input: { name: unknown; productId: unknown; packSize?: unknown; strength?: unknown }) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new TypeError('Variant name is required');
  if (typeof input.productId !== 'string' || !input.productId) throw new TypeError('Product ID is required');
  const product = await prisma.product.findUnique({ where: { id: input.productId }, select: { id: true } });
  if (!product) throw new MasterParentNotFoundError('Product not found');
  const normalizedVariantName = normalizeText(name);
  try {
    return await prisma.productVariant.create({ data: { variant_name: name, normalized_variant_name: normalizedVariantName, product_id: input.productId, pack_size: typeof input.packSize === 'string' ? input.packSize.trim() || null : null, strength: typeof input.strength === 'string' ? input.strength.trim() || null : null } });
  } catch (error) {
    if (isUniqueConflict(error)) {
      const existing = await prisma.productVariant.findFirst({ where: { product_id: input.productId, normalized_variant_name: normalizedVariantName }, select: { id: true } });
      throw new MasterAlreadyExistsError('Variant with this name already exists for this product', existing?.id);
    }
    throw error;
  }
}

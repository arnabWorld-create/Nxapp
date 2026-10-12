import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/auth';
import prisma from '../../lib/prisma';
import ProductCatalog from './ProductCatalog';

export default async function ProductsPage() {
  const user = await getCurrentUser();

  if (!user) redirect('/login');
  if (!user.role.role_permissions.some(({ permission }) => permission.name === 'manage_product')) redirect('/');

  const [divisions, brands] = await Promise.all([
    prisma.division.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        products: {
          select: {
            id: true,
            name: true,
            code: true,
            status: true,
            brand_id: true,
            division_id: true,
            brand: { select: { name: true } },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.brand.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const catalogDivisions = divisions.map((division) => ({
    ...division,
    products: division.products.map(({ brand, ...product }) => ({
      ...product,
      brand_name: brand?.name ?? null,
    })),
  }));
  const canManageBrand = user.role.role_permissions.some(({ permission }) => permission.name === 'manage_brand');

  return <ProductCatalog divisions={catalogDivisions} brands={brands} canManageBrand={canManageBrand} />;
}
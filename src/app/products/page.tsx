import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/auth';
import prisma from '../../lib/prisma';
import ProductCatalog from './ProductCatalog';

export default async function ProductsPage() {
  const user = await getCurrentUser();

  if (!user) redirect('/login');
  if (!user.role.role_permissions.some(({ permission }) => permission.name === 'manage_product')) redirect('/');

  const divisions = await prisma.division.findMany({
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
        },
        orderBy: { name: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  return <ProductCatalog divisions={divisions} />;
}
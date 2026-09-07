import { NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { userHasPermission } from '../../../../lib/import/upload';

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json(
      {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role.name,
          permissions: user.role.role_permissions.map((rp) => rp.permission.name),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Me error:', error);
    return NextResponse.json({ error: 'Unable to retrieve user' }, { status: 500 });
  }
}
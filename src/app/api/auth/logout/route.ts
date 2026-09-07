import { NextResponse } from 'next/server';
import { deleteSession } from '../../../../lib/auth';
import { SESSION_CONFIG } from '../../../../lib/auth/session';

export async function POST(request: Request) {
  try {
    const cookieToken = request.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${SESSION_CONFIG.cookieName}=`))
      ?.split('=')[1];

    if (cookieToken) {
      await deleteSession(cookieToken);
    }

    const response = NextResponse.json({ success: true }, { status: 200 });
    response.cookies.set(SESSION_CONFIG.cookieName, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ error: 'Unable to log out' }, { status: 500 });
  }
}
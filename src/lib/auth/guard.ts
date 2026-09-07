import { getUserById, userHasPermission } from '../import/upload';
import { resolveUserIdFromRequest } from './index';

/**
 * Shared authorization helper for API routes. Resolves the authenticated user
 * from the session cookie and checks permission. The legacy x-user-id header is
 * only accepted behind an explicit test/dev guard and never for production.
 */
export async function requireUser(request: Request): Promise<
  | { user: Awaited<ReturnType<typeof getUserById>> }
  | { response: Response }
> {
  const userId = await resolveUserIdFromRequest(request);
  if (!userId) {
    return { response: Response.json({ error: 'Missing authentication' }, { status: 401 }) };
  }

  const user = await getUserById(userId);
  if (!user) {
    return { response: Response.json({ error: 'User not found' }, { status: 403 }) };
  }

  return { user };
}

export async function requirePermission(
  request: Request,
  permission: string
): Promise<
  | { user: Awaited<ReturnType<typeof getUserById>> }
  | { response: Response }
> {
  const result = await requireUser(request);
  if ('response' in result) return result;

  if (!userHasPermission(result.user, permission)) {
    return { response: Response.json({ error: 'Permission denied' }, { status: 403 }) };
  }

  return { user: result.user };
}

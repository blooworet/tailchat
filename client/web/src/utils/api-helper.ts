import { getGlobalSocket } from '@/utils/global-state-helper';
import { getUserJWT } from '@/utils/jwt-helper';

/**
 * 调用用户服务
 * @param action 操作名
 * @param params 参数
 */
export async function callUserService(
  action: string,
  params?: Record<string, unknown>
) {
  const tok = await getUserJWT();
  const isLoginFlow = action === 'login' || action === 'register' || action === 'resolveToken';
  let socket = getGlobalSocket();
  if (!socket || !socket.connected) {
    const mod: any = await import('tailchat-shared');
    if (typeof tok === 'string' && tok.length > 0) {
      socket = await mod.createSocket(tok);
    } else if (isLoginFlow) {
      socket = await mod.createSocket(undefined, { allowGuest: true });
    } else {
      throw new Error('Auth required for WebSocket');
    }
  }
  return socket.request('user.' + action, params ?? {});
}

/**
 * 调用公共用户服务 (无需登录即可访问)
 * @param action 操作名
 * @param params 参数
 */
export async function callPublicUserService(
  action: string,
  params?: Record<string, unknown>
) {
  // 公共用户服务统一走 HTTP，避免游客 WS
  const mod: any = await import('tailchat-shared');
  const { request } = mod;
  const { data } = await request.post('/api/user/' + action, params ?? {});
  return data;
}
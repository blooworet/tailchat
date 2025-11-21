import type { ScopeKey } from './types';

export function buildScopeKey(opts: {
  isGroup?: boolean;
  converseId?: string;
  userId?: string;
  scopeType?: 'default' | 'all_private_chats' | 'all_group_chats' | 'chat' | 'chat_member';
}): ScopeKey {
  const { isGroup, converseId, userId, scopeType } = opts;
  const t = scopeType || 'default';
  if (t === 'all_private_chats') return 'dm';
  if (t === 'all_group_chats') return 'grp';
  if (t === 'chat' && converseId) return `chat:${converseId}`;
  if (t === 'chat_member' && converseId && userId) return `chat_member:${converseId}:${userId}`;
  if (isGroup === true) return 'grp';
  if (isGroup === false) return 'dm';
  return 'def';
}

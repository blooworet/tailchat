const inlineActionsCache = new Map<string, any>();
const tokensCache = new Map<string, any>();

function buildKey(messageId: string, signature?: string) {
  const id = String(messageId);
  return signature ? `${id}::${signature}` : id;
}

// 轻量级字符串哈希（djb2 变体），用于签名
function fastHash(str: string): string {
  let hash = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash = (((hash << 5) + hash) ^ str.charCodeAt(i)) >>> 0;
  }
  // 返回 8 位十六进制
  return ('00000000' + hash.toString(16)).slice(-8);
}

/**
 * 基于内容与更新时间构建缓存签名
 * - 使用 content 的 fastHash，保证任何位置的文本变更都会产生不同签名
 * - 可选包含 inlineSignature（服务端 meta.inlineActions.signature 或者推导值）
 */
export function buildMessageCacheSignature(content: string, updatedAt?: string, inlineSignature?: string) {
  const text = String(content || '');
  const ts = String(updatedAt || '');
  const h = fastHash(text);
  const is = typeof inlineSignature === 'string' ? inlineSignature : '';
  return `${ts}#${h}:${is}`;
}

export function setInlineActions(messageId: string, meta: any, signature?: string) {
  if (!messageId) return;
  inlineActionsCache.set(buildKey(messageId, signature), meta);
}

export function getInlineActions(messageId: string, signature?: string) {
  return inlineActionsCache.get(buildKey(messageId, signature));
}

export function setTokens(messageId: string, tokens: any, signature?: string) {
  if (!messageId) return;
  tokensCache.set(buildKey(messageId, signature), tokens);
}

export function getTokens(messageId: string, signature?: string) {
  return tokensCache.get(buildKey(messageId, signature));
}

export function clearCaches() {
  inlineActionsCache.clear();
  tokensCache.clear();
}

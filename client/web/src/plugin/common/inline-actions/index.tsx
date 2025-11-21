import React, { useEffect } from 'react';
import { showToasts, regSocketEventListener } from 'tailchat-shared';
import { getGlobalSocket } from '@/utils/global-state-helper';

// M1: Inline Actions skeleton types
export interface InlineActionItem {
  id: string;
  type: 'command' | 'url' | 'invoke' | 'modal' | 'deeplink';
  label?: string;
  params?: Record<string, unknown>;
}

export interface InlineActionRange {
  offset: number;
  length: number;
  style?: string;
  actionId: string; // link to actions
}

export interface InlineKeyboardRow {
  actions: string[]; // action ids
  label?: string; // optional row label for grouping
}

export interface InlineActionsMeta {
  actions: InlineActionItem[];
  ranges?: InlineActionRange[];
  keyboard?: InlineKeyboardRow[];
  scopes?: string[];
  signature?: string;
  analytics?: {
    traceId?: string;
  };
}

// Decorator registry (M2)
export interface InlineActionDecoratorContext {
  text: string;
}
export interface InlineActionDecoratorResult {
  actions: InlineActionItem[];
  ranges: InlineActionRange[];
}
export type InlineActionDecorator = (
  ctx: InlineActionDecoratorContext
) => InlineActionDecoratorResult | null | undefined;

const decorators: InlineActionDecorator[] = [];

async function wsRequest(action: string, params?: any): Promise<any> {
  try {
    let socket = getGlobalSocket();
    if (!socket || !socket.connected) {
      const mod: any = await import('tailchat-shared');
      socket = await mod.createSocket();
    }
    return await socket.request(action, params ?? {});
  } catch (e) {
    throw e;
  }
}
export function regInlineActionDecorator(dec: InlineActionDecorator) {
  decorators.push(dec);
}
export function runInlineActionDecorators(text: string): InlineActionsMeta | null {
  if (!text) return null;
  let actions: InlineActionItem[] = [];
  let ranges: InlineActionRange[] = [];
  for (const dec of decorators) {
    try {
      const res = dec({ text });
      if (res && res.actions && res.ranges) {
        actions = actions.concat(res.actions);
        ranges = ranges.concat(res.ranges);
      }
    } catch {}
  }
  if (actions.length === 0 || ranges.length === 0) return null;
  // 去重：按 id 去重 actions，按 (offset,length,actionId) 去重 ranges
  const actionMap = new Map<string, InlineActionItem>();
  for (const a of actions) {
    if (!actionMap.has(a.id)) actionMap.set(a.id, a);
  }
  const rangeKey = (r: InlineActionRange) => `${r.offset}:${r.length}:${r.actionId}`;
  const rangeMap = new Map<string, InlineActionRange>();
  for (const r of ranges) {
    const k = rangeKey(r);
    if (!rangeMap.has(k)) rangeMap.set(k, r);
  }
  return {
    actions: Array.from(actionMap.values()),
    ranges: Array.from(rangeMap.values()),
  };
}

// Tokenizer → AST → Renderer skeleton

export type TextNode = { type: 'text'; text: string };
export type ActionTextNode = {
  type: 'action-text';
  text: string;
  actionId: string;
};
export type AstNode = TextNode | ActionTextNode;

// 检测BBCode标签的正则，特别是[at=xxx]这样的@mention标签
const BBCODE_TAG_REGEX = /\[(at|url|img|card|emoji|b|i|u|del|md)(?:=[^\]]*)?](.*?)\[\/\1]/gs;

/**
 * 保护BBCode标签不被内联动作范围分割
 * 此函数检查范围是否与BBCode标签重叠，如果重叠则调整范围
 */
function protectBBCodeTags(text: string, ranges: InlineActionRange[]): InlineActionRange[] {
  if (!text || !ranges || ranges.length === 0) return ranges;
  
  // 找出所有BBCode标签的位置
  const tagPositions: Array<{start: number, end: number}> = [];
  let match;
  while ((match = BBCODE_TAG_REGEX.exec(text)) !== null) {
    tagPositions.push({
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  // 如果没有找到标签，直接返回原始范围
  if (tagPositions.length === 0) return ranges;
  
  // 检查每个范围是否与标签重叠，如果重叠则跳过该范围
  return ranges.filter(range => {
    const rangeStart = range.offset;
    const rangeEnd = range.offset + range.length;
    
    // 检查是否与任何标签重叠
    for (const tag of tagPositions) {
      // 如果范围完全在标签内部或与标签部分重叠，则跳过
      if (!(rangeEnd <= tag.start || rangeStart >= tag.end)) {
        return false;
      }
    }
    return true;
  });
}

export function tokenizeWithRanges(text: string, ranges: InlineActionRange[] = []): AstNode[] {
  if (!text) return [];
  if (!ranges || ranges.length === 0) return [{ type: 'text', text }];

  // 保护BBCode标签，调整ranges避免分割标签
  const protectedRanges = protectBBCodeTags(text, ranges);
  
  const nodes: AstNode[] = [];
  let cursor = 0;
  const sorted = [...protectedRanges].sort((a, b) => a.offset - b.offset);
  for (const r of sorted) {
    const start = Math.max(0, r.offset);
    const end = Math.min(text.length, r.offset + r.length);
    if (cursor < start) {
      nodes.push({ type: 'text', text: text.slice(cursor, start) });
    }
    if (start < end) {
      nodes.push({ type: 'action-text', text: text.slice(start, end), actionId: r.actionId });
    }
    cursor = end;
  }
  if (cursor < text.length) {
    nodes.push({ type: 'text', text: text.slice(cursor) });
  }
  return nodes;
}

// M6: 简单 AST 缓存（基于文本+range 指纹），避免重复分割
const astCache = new Map<string, AstNode[]>();
function buildRangeFingerprint(ranges: InlineActionRange[] = []) {
  if (!ranges || ranges.length === 0) return '0';
  return ranges.map((r) => `${r.offset}:${r.length}:${r.actionId}`).join('|');
}
export function tokenizeWithRangesCached(text: string, ranges: InlineActionRange[] = []): AstNode[] {
  // 添加判断，如果文本包含BBCode标签，则进行特殊处理
  if (text && ranges && ranges.length > 0) {
    // 重置正则表达式的lastIndex以确保从文本开始处匹配
    BBCODE_TAG_REGEX.lastIndex = 0;
    if (BBCODE_TAG_REGEX.test(text)) {
      // 如果包含BBCode标签，生成更特殊的缓存键，包含提示
      const key = `bbcode_${text}__${buildRangeFingerprint(ranges)}`;
      const cached = astCache.get(key);
      if (cached) return cached;
      
      // 使用保护BBCode标签的逻辑
      const nodes = tokenizeWithRanges(text, ranges);
      astCache.set(key, nodes);
      return nodes;
    }
  }
  
  // 原始逻辑，不包含BBCode标签的正常处理
  const key = `${text}__${buildRangeFingerprint(ranges)}`;
  const cached = astCache.get(key);
  if (cached) return cached;
  const nodes = tokenizeWithRanges(text, ranges);
  astCache.set(key, nodes);
  return nodes;
}

// 检查文本是否包含完整BBCode标签的函数
function hasBBCodeTags(text: string): boolean {
  // 重置正则表达式的lastIndex以确保从文本开始处匹配
  BBCODE_TAG_REGEX.lastIndex = 0;
  return BBCODE_TAG_REGEX.test(text);
}

export function renderInlineText(
  nodes: AstNode[],
  opts: {
    actions?: Record<string, InlineActionItem>;
    onActionClick?: (action: InlineActionItem) => void;
  } = {}
) {
  const { actions = {}, onActionClick } = opts;
  // A/B: 仅保留延迟装饰（defer），移除禁用开关
  try {
    if (typeof window !== 'undefined') {
      const w: any = window as any;
      const defer = w.__TC_AB?.inline_defer === true || window.localStorage.getItem('tc_ab_inline_defer') === 'true';
      if (defer && document && document.readyState !== 'complete') {
        return nodes.map((n, i) => <React.Fragment key={i}>{(n as any).text || ''}</React.Fragment>);
      }
    }
  } catch {}

  // M6: 渲染曝光埋点（会话内去重）
  try {
    const ids = Object.keys(actions).sort().join(',');
    const cacheKey = `impress:text:${ids}`;
    const cache: any = (window as any).__tc_inline_impressions__ || ((window as any).__tc_inline_impressions__ = new Set());
    if (!cache.has(cacheKey) && ids) {
      cache.add(cacheKey);
      setTimeout(() => {
        (async () => {
          try {
            await wsRequest('inline.action.track', {
              event: 'inline.text.render',
              extra: { actions: ids.split(',') },
            });
          } catch {}
        })();
      }, 0);
    }
  } catch {}
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === 'text') {
          const { getMessageRender } = require('@/plugin/common');
          // 对包含完整BBCode标签(特别是@mention的[at]标签)的文本进行特殊处理
          // 这确保像[at=123]username[/at]这样的标签会被正确解析，而不是被拆分
          if (hasBBCodeTags(n.text)) {
            try {
              return <React.Fragment key={i}>{getMessageRender(n.text)}</React.Fragment>;
            } catch (e) {
              console.error("处理BBCode文本时出错:", e);
              return <React.Fragment key={i}>{n.text}</React.Fragment>;
            }
          } else {
            // 对不包含完整BBCode标签的普通文本使用标准渲染
            return <React.Fragment key={i}>{getMessageRender(n.text)}</React.Fragment>;
          }
        }
        const action = actions[n.actionId];
        if (!action) {
          const { getMessageRender } = require('@/plugin/common');
          return <React.Fragment key={i}>{getMessageRender(n.text)}</React.Fragment>;
        }
        const label = n.text || action.label || '';
        const handle = () => onActionClick && onActionClick(action);
        const sourceVal = String((action.params as any)?._source || 'inline');
        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            aria-label={action.label || 'inline action'}
            aria-keyshortcuts="Enter Space"
            data-action-id={action.id}
            data-action-type={action.type}
            data-action-source={sourceVal}
            className="tc-inline-action-text"
            onClick={handle}
            onKeyDown={(e: any) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handle();
              }
            }}
          >
            {label}
          </span>
        );
      })}
    </>
  );
}

export function renderInlineKeyboard(
  keyboard: InlineKeyboardRow[] = [],
  actions: Record<string, InlineActionItem> = {},
  onActionClick?: (action: InlineActionItem) => void
) {
  // A/B: 仅保留延迟渲染（defer），移除禁用开关
  try {
    if (typeof window !== 'undefined') {
      const w: any = window as any;
      const defer = w.__TC_AB?.keyboard_defer === true || window.localStorage.getItem('tc_ab_keyboard_defer') === 'true';
      if (defer && document && document.readyState !== 'complete') {
        return null;
      }
    }
  } catch {}
  if (!keyboard || keyboard.length === 0) return null;

  // M6: 键盘渲染曝光埋点（会话内去重）
  try {
    const actionIds = keyboard.flatMap((row) => row.actions).filter(Boolean);
    const ids = Array.from(new Set(actionIds)).sort().join(',');
    const cacheKey = `impress:keyboard:${ids}`;
    const cache: any = (window as any).__tc_inline_impressions__ || ((window as any).__tc_inline_impressions__ = new Set());
    if (!cache.has(cacheKey) && ids) {
      cache.add(cacheKey);
      setTimeout(() => {
        (async () => {
          try {
            await wsRequest('inline.action.track', {
              event: 'inline.keyboard.render',
              extra: { actions: ids.split(',') },
            });
          } catch {}
        })();
      }, 0);
    }
  } catch {}
  return (
    <div className="mt-1 flex flex-col gap-1 text-xs" aria-label="内联键盘">
      {keyboard.map((row, ridx) => (
        <div key={ridx} className="flex flex-col gap-0.5">
          {row.label ? (
            <div id={`kbd-row-label-${ridx}`} className="opacity-70 mb-0.5" aria-hidden="true">{row.label}</div>
          ) : null}
          <div
            className="flex flex-row flex-wrap justify-center gap-2"
            role="group"
            {...(row.label
              ? { 'aria-labelledby': `kbd-row-label-${ridx}` }
              : { 'aria-label': `row-${ridx}` })}
          >
            {row.actions.map((aid) => {
              const action = actions[aid];
              if (!action) return null;
              const isDisabled = (action.params as any)?.disabled === true;
              const handle = () => {
                if (!onActionClick || isDisabled) return;
                // 标注来源为 keyboard
                const enriched = {
                  ...action,
                  params: { ...(action.params || {}), _source: 'keyboard' },
                } as InlineActionItem;
                onActionClick(enriched);
              };
              const sourceVal = String((action.params as any)?._source || 'keyboard');
              return (
                <span
                  key={aid}
                  role="button"
                  tabIndex={isDisabled ? -1 : 0}
                  aria-label={action.label || 'inline action button'}
                  aria-disabled={isDisabled || undefined}
                  aria-keyshortcuts="Enter Space"
                  data-action-id={action.id}
                  data-action-type={action.type}
                  data-action-source={sourceVal}
                  data-priority={(action.params as any)?.priority || 'secondary'}
                  className="tc-inline-action-btn select-none"
                  onClick={handle}
                  onKeyDown={(e: any) => {
                    if (isDisabled) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handle();
                    }
                  }}
                >
                  {action.label || action.id}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// 默认点击行为（仅处理 command；其他类型预留到 M4）
export function defaultOnActionClick(action: InlineActionItem, messageContext?: { messageId?: string; converseId?: string; groupId?: string }) {
  try {
    // 延迟导入以减少主包体积
    const { sharedEvent, showErrorToasts, t } = require('tailchat-shared');
    const { postRequest, openConfirmModal } = require('@/plugin/common');
    // 防抖：短时间内重复点击同一 action 直接忽略
    const guardKey = `click:${action.id}`;
    const guardSet: any = (window as any).__tc_inline_click_guard__ || ((window as any).__tc_inline_click_guard__ = new Set());
    if (guardSet.has(guardKey)) {
      return;
    }
    guardSet.add(guardKey);
    setTimeout(() => {
      try { guardSet.delete(guardKey); } catch {}
    }, 500);
    if (action.type === 'command') {
      const sourceVal = String((action.params as any)?._source || 'inline');
      const text = String(action.params?.text ?? action.label ?? '').trim();
      const mode: 'replace' | 'send' = (action.params?.mode as any) || 'replace';
      let traceId = String(action.params?.traceId || '');
      if (!traceId) {
        traceId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      }
      const textToApply = mode === 'replace' && text ? `${text} ` : text;
      sharedEvent.emit('applyChatInput', {
        text: textToApply || '',
        mode: mode === 'send' ? 'send' : 'replace',
        source: sourceVal,
        actionId: action.id,
        traceId: traceId || undefined,
      });
      // 埋点：命令点击
      try {
        wsRequest('inline.action.track', {
          event: 'inline.command.click',
          actionId: action.id,
          traceId: traceId || undefined,
          extra: { mode, source: sourceVal, type: action.type, label: action.label, botId: (action.params as any)?.botId },
        }).catch(() => void 0);
      } catch {}
      return;
    }

    // 非 command：调用网关（M4 最小闭环）
    let traceId = String(action.params?.traceId || '');
    const signature = String(action.params?.sig || '');
    const sourceVal = String((action.params as any)?._source || 'inline');
    if (!traceId) {
      traceId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    // 可选确认
    try {
      const needConfirm = (action.params as any)?.confirm === true;
      if (needConfirm && typeof window !== 'undefined') {
        const ok = window.confirm('确认执行该操作？');
        if (!ok) return;
      }
    } catch {}
    const clickPayload: any = {
      actionId: action.id,
      type: action.type,
      params: action.params || {},
      signature: signature || undefined,
      analytics: {
        source: sourceVal,
        traceId: traceId || undefined,
      },
      // 添加消息上下文信息
      originalMessageId: messageContext?.messageId,
      converseId: messageContext?.converseId,
      groupId: messageContext?.groupId,
    };
    // 透传 botId（如存在），便于服务端路由到对应机器人
    try {
      const bid = (action.params as any)?.botId;
      if (bid) {
        clickPayload.botId = String(bid);
      }
    } catch {}
    function getInlineErrorMessage(err: any): string {
      try {
        const code = String(
          (err && (err.response?.data?.name || err.response?.data?.error || err.response?.data?.code)) || ''
        ).toUpperCase();
        const msg = String(err?.response?.data?.message || err?.message || '');
        switch (code) {
          case 'INVALID_SIGNATURE':
            return (t && t('签名无效，操作被阻止')) || '签名无效，操作被阻止';
          case 'URL_SCHEME_NOT_ALLOWED':
            return (t && t('不被允许的链接协议')) || '不被允许的链接协议';
          case 'URL_NOT_ALLOWED':
            return (t && t('链接未通过白名单校验')) || '链接未通过白名单校验';
          case 'INVALID_URL':
            return (t && t('无效的链接')) || '无效的链接';
          case 'DEEPLINK_NOT_ALLOWED':
            return (t && t('不被允许的跳转协议')) || '不被允许的跳转协议';
          case 'INVALID_DEEPLINK':
            return (t && t('无效的跳转链接')) || '无效的跳转链接';
          case 'RATE_LIMIT':
            return (t && t('操作过于频繁，请稍后再试')) || '操作过于频繁，请稍后再试';
          case 'SCOPE_DENIED':
            return (t && t('机器人权限不足（Scope 校验未通过）')) || '机器人权限不足（Scope 校验未通过）';
          case 'COMMAND_NOT_ALLOWED':
            return (t && t('不支持的操作类型')) || '不支持的操作类型';
        }
        if (msg) return msg;
      } catch {}
      return (t && t('操作被阻止')) || '操作被阻止';
    }

    if (action.type === 'url') {
      const url = String((action.params as any)?.url || '');
      if (!url) return;
      // 前端URL Scheme防护
      try {
        const u = new URL(url);
        const scheme = (u.protocol || '').toLowerCase();
        if (scheme !== 'http:' && scheme !== 'https:') {
          try { showErrorToasts((t && t('不被允许的链接协议')) || '不被允许的链接协议'); } catch {}
          return;
        }
      } catch {
        try { showErrorToasts((t && t('无效的链接')) || '无效的链接'); } catch {}
        return;
      }
      const __t0 = Date.now();
      wsRequest('inline.action.click', clickPayload)
        .then((res: any) => {
          try {
            window.open(url, '_blank');
            // 埋点：URL 打开
            try {
              wsRequest('inline.action.track', {
                event: 'inline.url.opened',
                actionId: action.id,
                traceId: traceId || undefined,
                extra: { url },
              }).catch(() => void 0);
            } catch {}
            // 埋点：点击路由耗时
            try {
              const cost = (res && res.routeDurationMs) || (Date.now() - __t0);
              wsRequest('inline.action.track', {
                event: 'inline.click.routed',
                actionId: action.id,
                traceId: traceId || undefined,
                extra: { type: action.type, cost },
              }).catch(() => void 0);
            } catch {}
          } catch {}
        })
        .catch((err: any) => {
          try { showErrorToasts(getInlineErrorMessage(err)); } catch {}
          // 错误码上报
          try {
            const code = String(
              (err && (err.response?.data?.name || err.response?.data?.error || err.response?.data?.code)) || ''
            ).toUpperCase();
            wsRequest('inline.action.track', {
              event: 'inline.action.error',
              actionId: action.id,
              traceId: traceId || undefined,
              extra: { type: action.type, code },
            }).catch(() => void 0);
          } catch {}
        });
    } else if (action.type === 'modal') {
      const title = String((action.params as any)?.title || action.label || '操作确认');
      const content = String((action.params as any)?.content || '是否确认执行该操作？');
      try {
        openConfirmModal?.({
          title,
          content,
          onConfirm: () => {
            wsRequest('inline.action.click', clickPayload).catch((err: any) => {
              try { showErrorToasts(getInlineErrorMessage(err)); } catch {}
            });
            // 埋点：modal 确认
            try {
              wsRequest('inline.action.track', {
                event: 'inline.modal.confirm',
                actionId: action.id,
                traceId: traceId || undefined,
                extra: { source: sourceVal, label: action.label },
              }).catch(() => void 0);
            } catch {}
          },
        });
      } catch {
        // 降级：无弹窗能力时直接路由
        wsRequest('inline.action.click', clickPayload).catch((err: any) => {
          try { showErrorToasts(getInlineErrorMessage(err)); } catch {}
        });
      }
    } else if (action.type === 'deeplink') {
      const link = String((action.params as any)?.link || (action.params as any)?.url || '');
      if (!link) return;
      // Deeplink 允许的协议白名单（可按需扩展）
      try {
        const u = new URL(link);
        const scheme = (u.protocol || '').toLowerCase();
        const allowed = ['http:', 'https:', 'tailchat:', 'tc:'];
        if (!allowed.includes(scheme)) {
          try { showErrorToasts((t && t('不被允许的跳转协议')) || '不被允许的跳转协议'); } catch {}
          return;
        }
      } catch {
        // 非标准URL，直接尝试在网关成功后跳转（由系统处理）
      }
      // 先网关校验，再尝试跳转
      const __t1 = Date.now();
      wsRequest('inline.action.click', clickPayload)
        .then((res: any) => {
          try { window.location.href = link; } catch {}
          // 埋点：deeplink 跳转
          try {
            wsRequest('inline.action.track', {
              event: 'inline.deeplink.opened',
              actionId: action.id,
              traceId: traceId || undefined,
              extra: { link },
            }).catch(() => void 0);
          } catch {}
          // 埋点：点击路由耗时
          try {
            const cost = (res && res.routeDurationMs) || (Date.now() - __t1);
            wsRequest('inline.action.track', {
              event: 'inline.click.routed',
              actionId: action.id,
              traceId: traceId || undefined,
              extra: { type: action.type, cost },
            }).catch(() => void 0);
          } catch {}
        })
        .catch((err: any) => {
          try { showErrorToasts(getInlineErrorMessage(err)); } catch {}
          // 错误码上报
          try {
            const code = String(
              (err && (err.response?.data?.name || err.response?.data?.error || err.response?.data?.code)) || ''
            ).toUpperCase();
            wsRequest('inline.action.track', {
              event: 'inline.action.error',
              actionId: action.id,
              traceId: traceId || undefined,
              extra: { type: action.type, code },
            }).catch(() => void 0);
          } catch {}
        });
    } else {
      const __t2 = Date.now();
      wsRequest('inline.action.click', clickPayload).then((res: any) => {
        // 埋点：invoke/modal/url 之外的通用非命令动作（如 invoke）
        try {
          wsRequest('inline.action.track', {
            event: 'inline.invoke.sent',
            actionId: action.id,
            traceId: traceId || undefined,
            extra: { source: sourceVal, label: action.label, type: action.type, botId: (action.params as any)?.botId },
          }).catch(() => void 0);
        } catch {}
        // 埋点：点击路由耗时
        try {
          const cost = (res && res.routeDurationMs) || (Date.now() - __t2);
          wsRequest('inline.action.track', {
            event: 'inline.click.routed',
            actionId: action.id,
            traceId: traceId || undefined,
            extra: { type: action.type, cost },
          }).catch(() => void 0);
        } catch {}
      }).catch((err: any) => {
        try { showErrorToasts(getInlineErrorMessage(err)); } catch {}
        // 错误码上报
        try {
          const code = String(
            (err && (err.response?.data?.name || err.response?.data?.error || err.response?.data?.code)) || ''
          ).toUpperCase();
          wsRequest('inline.action.track', {
            event: 'inline.action.error',
            actionId: action.id,
            traceId: traceId || undefined,
            extra: { type: action.type, code },
          }).catch(() => void 0);
        } catch {}
      });
    }

    // 埋点：通用点击
  try {
    wsRequest('inline.action.track', {
        event: 'inline.action.click',
        actionId: action.id,
        traceId: traceId || undefined,
        extra: { type: action.type, source: sourceVal, label: action.label, botId: (action.params as any)?.botId },
      }).catch(() => void 0);
    } catch {}
  } catch {}
}

/**
 * 注册机器人回调响应监听器
 * 监听服务端推送的 bot.callback.answer 事件，显示提示框给用户
 */
regSocketEventListener({
  eventName: 'bot.callback.answer',
  eventFn: (payload: {
    text: string;
    show_alert: boolean;
    traceId: string;
    ts: number;
  }) => {
    try {
      const { text, show_alert } = payload;
      
      if (!text) {
        return;
      }
      
      // 根据 show_alert 决定显示方式
      if (show_alert) {
        // 显示弹窗 - 使用 openConfirmModal（延迟导入避免循环依赖）
        try {
          const { openConfirmModal, localTrans } = require('@/plugin/common');
          const t = localTrans || ((key: string) => key);
          openConfirmModal({
            title: t('k_bot_callback_tip'),
            content: text,
            onConfirm: () => {
              // 用户点击确定后关闭弹窗
            },
          });
        } catch (err) {
          // 降级：如果 openConfirmModal 不可用，使用原生 alert
          if (typeof window !== 'undefined') {
            window.alert(text);
          }
        }
      } else {
        // 显示 Toast 气泡
        showToasts(text, 'info');
      }
    } catch (err) {
      console.error('[BotCallback] 处理回调响应失败:', err);
    }
  }
});



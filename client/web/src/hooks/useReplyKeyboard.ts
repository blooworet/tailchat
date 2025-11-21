import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ReplyKeyboardMeta } from '../../../shared/types/reply-keyboard';

export type UseReplyKeyboardOptions = {
  converseId?: string | null;
  userId?: string | null;
  messages: Array<any>;
};

export function useReplyKeyboard({ converseId, userId, messages }: UseReplyKeyboardOptions) {
  const [dismissedByClick, setDismissedByClick] = useState(false);
  // 用户显式切换（仅用于 trigger=button 情况）
  const [isOpen, setIsOpen] = useState(false);
  const lastMsgIdRef = useRef<string | null>(null);
  // 避免初始一帧闪动：新RK到达后短暂等待（例如后端补全字段/状态传播），再决定是否展示
  const [ready, setReady] = useState(true);

  // Find latest message that carries replyKeyboard meta
  const latest = useMemo(() => {
    if (!Array.isArray(messages) || messages.length === 0) return null as any;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const meta = (m?.meta || {}) as any;
      const rk = meta.replyKeyboard as ReplyKeyboardMeta | undefined;
      if (rk && (rk.remove === true || (Array.isArray(rk.keyboard) && rk.keyboard.length > 0))) {
        return { m, rk };
      }
    }
    return null as any;
  }, [messages]);

  // 新的 RK 到达时：重置一次性关闭状态，并开启一个短暂的就绪延时，避免首帧闪动
  useEffect(() => {
    const curId = latest?.m?._id ? String(latest.m._id) : null;
    if (curId && curId !== lastMsgIdRef.current) {
      lastMsgIdRef.current = curId;
      setDismissedByClick(false);
      // 在新消息到达后，短暂关闭展示，等待后端补全字段/状态稳定
      setReady(false);
      const timer = setTimeout(() => setReady(true), 120);
      return () => clearTimeout(timer);
    }
  }, [latest?.m?._id]);

  const baseMeta: ReplyKeyboardMeta | null = useMemo(() => {
    if (!latest) return null;
    const rk = latest.rk as ReplyKeyboardMeta;
    if (rk.remove === true) return null;
    if (!Array.isArray(rk.keyboard) || rk.keyboard.length === 0) return null;
    if (dismissedByClick && rk.one_time === true) return null;

    // selective visibility in group
    const visibleFor = rk.selective?.visibleForUserIds;
    if (Array.isArray(visibleFor) && visibleFor.length > 0) {
      const uid = String(userId || '');
      if (!uid || !visibleFor.includes(uid)) return null;
    }
    return rk;
  }, [latest, dismissedByClick, userId]);

  // 根据 trigger 与显式开关计算是否展示面板（消除状态二次更新导致的闪烁）
  const showPanel = useMemo(() => {
    if (!baseMeta) return false;
    if (baseMeta.trigger === 'button') {
      return isOpen; // 仅由用户切换
    }
    // trigger 未显式为 'button'：仅在 ready=true 时展示，避免首帧闪一下
    return ready;
  }, [baseMeta, isOpen, ready]);

  const activeMeta: ReplyKeyboardMeta | null = useMemo(() => {
    if (!baseMeta) return null;
    if (!showPanel) return null;
    return baseMeta;
  }, [baseMeta, showPanel]);

  const placeholder = useMemo(() => {
    // 仅在展示面板时提供占位符
    return showPanel ? baseMeta?.placeholder : undefined;
  }, [baseMeta?.placeholder, showPanel]);

  const dismiss = useCallback(() => {
    setDismissedByClick(true);
    setIsOpen(false);
  }, []);

  const toggleOpen = useCallback((next?: boolean) => {
    setIsOpen((prev) => (typeof next === 'boolean' ? next : !prev));
  }, []);

  const showToggle = !!baseMeta && baseMeta.trigger === 'button';

  return { activeMeta, placeholder, dismiss, isOpen, toggleOpen, showToggle, rawMeta: baseMeta };
}

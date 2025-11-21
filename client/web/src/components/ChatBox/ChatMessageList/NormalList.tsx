import React, { useEffect, useMemo, useRef, useState } from 'react';
import { t, useEvent, useSharedEventHandler, useUserSettings, useUserInfo } from 'tailchat-shared';
import { useAppSelector } from 'tailchat-shared/redux/hooks/useAppSelector';
import { ChatMessageHeader } from './ChatMessageHeader';
import { buildMessageItemRow } from './Item';
import { ScrollToBottom } from './ScrollToBottom';
import type { MessageListProps } from './types';
import { Divider } from 'antd';

/**
 * 距离顶部触发加载更多的 buffer
 * 并处理在某些场景下计算位置会少1px导致无法正确触发加载的问题
 */
const topTriggerBuffer = 100;
const bottomTriggerBuffer = 40;

/**
 * 没有虚拟化版本的聊天列表
 */
export const NormalMessageList: React.FC<MessageListProps> = React.memo(
  (props) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const lockRef = useRef(false);
    const prevConverseIdRef = useRef<string | null>(null);
    const firstRenderedRef = useRef<boolean>(false);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const { settings } = useUserSettings();
    const gifPolicy = settings['telegram.gifPolicy'] ?? 'pauseOffscreen';
    const currentUser = useUserInfo();
    const converseId = String(props.messages?.[0]?.converseId || '');
    const ackId = useAppSelector((state) => state.chat.ack[converseId]);
    const memberAckMap = useAppSelector((state) => state.chat.memberAcks[converseId] || {});
    const [baselineAck, setBaselineAck] = useState<string | undefined>(undefined);

    const selfId = String(currentUser?._id || '');
    const computeAckInfo = useMemo(() => {
      if (!selfId) return () => undefined as any;
      const others = Object.entries(memberAckMap)
        .filter(([uid]) => String(uid) !== selfId)
        .map(([, id]) => String(id));
      const ge = (a: string, b: string) => a >= b;
      return (msgId: string) => {
        if (others.length === 0) return { anyRead: false, allRead: false };
        const anyRead = others.some((lastId) => ge(lastId, msgId));
        const allRead = others.every((lastId) => ge(lastId, msgId));
        return { anyRead, allRead };
      };
    }, [memberAckMap, selfId]);

    const unreadDividerIndex = useMemo(() => {
      const fixedAck = baselineAck;
      if (!fixedAck || !props.messages || props.messages.length === 0) return -1;
      for (let i = 0; i < props.messages.length; i++) {
        const prevId = i > 0 ? String(props.messages[i - 1]?._id || '') : '';
        const curId = String(props.messages[i]?._id || '');
        if ((prevId !== '' && prevId <= fixedAck) && curId > fixedAck) {
          return i;
        }
      }
      return -1;
    }, [props.messages, baselineAck]);

    // Set baseline ack only on conversation switch, or first time ack appears
    useEffect(() => {
      const cur = converseId;
      const isSwitch = prevConverseIdRef.current !== cur;
      if (isSwitch) {
        prevConverseIdRef.current = cur;
        setBaselineAck(ackId);
        return;
      }
      if (!baselineAck && ackId) {
        setBaselineAck(ackId);
      }
    }, [converseId, ackId, baselineAck]);

    // Basic media lazy enhancements: set loading/decoding and pause offscreen videos/GIFs (deferred, near-viewport only)
    useEffect(() => {
      const root = containerRef.current;
      if (!root) return;
      let cleanup: (() => void) | undefined;
      const schedule = (fn: () => void) => {
        if (typeof (window as any).requestIdleCallback === 'function') {
          const id = (window as any).requestIdleCallback(fn, { timeout: 500 });
          return () => (window as any).cancelIdleCallback?.(id);
        } else {
          const id = setTimeout(fn, 100);
          return () => clearTimeout(id as any);
        }
      };

      cleanup = schedule(() => {
        // hint images
        const imgs = root.querySelectorAll<HTMLImageElement>('img');
        imgs.forEach((img) => {
          if (!img.getAttribute('loading')) img.setAttribute('loading', 'lazy');
          if (!img.getAttribute('decoding')) img.setAttribute('decoding', 'async');
        });

        // pause/play videos & animated images (GIF via <img>) on intersection
        const vids = root.querySelectorAll<HTMLVideoElement>('video');
        const imgEls = root.querySelectorAll<HTMLImageElement>('img');
        const animatedImgs = Array.from(imgEls).filter((img) => /\.gif($|\?)/i.test(img.src));

        // near-viewport filter
        const near = (el: Element) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.bottom >= -512 && r.top <= (root.clientHeight + 512);
        };

        const nearVids = Array.from(vids).filter(near);
        const nearGifs = animatedImgs.filter(near);

        let io: IntersectionObserver | null = null;
        let gifIo: IntersectionObserver | null = null;

        if (nearVids.length > 0) {
          io = new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                const v = entry.target as HTMLVideoElement;
                if (!v) return;
                try {
                  if (entry.isIntersecting) {
                    if (v.autoplay && v.paused) v.play().catch(() => void 0);
                  } else {
                    if (!v.paused) v.pause();
                  }
                } catch {}
              });
            },
            { root: root, rootMargin: '64px 0px 64px 0px', threshold: 0.01 }
          );
          nearVids.forEach((v) => io!.observe(v));
        }

        if (nearGifs.length > 0 && gifPolicy === 'pauseOffscreen') {
          gifIo = new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                const el = entry.target as HTMLImageElement;
                const orig = el.getAttribute('data-gif-src') || el.src;
                if (entry.isIntersecting) {
                  if (el.getAttribute('data-gif-src')) {
                    el.src = el.getAttribute('data-gif-src')!;
                    el.removeAttribute('data-gif-src');
                  }
                } else {
                  if (!el.getAttribute('data-gif-src')) {
                    el.setAttribute('data-gif-src', orig);
                    try {
                      const canvas = document.createElement('canvas');
                      canvas.width = el.naturalWidth;
                      canvas.height = el.naturalHeight;
                      const ctx = canvas.getContext('2d');
                      if (ctx) {
                        ctx.drawImage(el, 0, 0);
                        el.src = canvas.toDataURL('image/png');
                      }
                    } catch {}
                  }
                }
              });
            },
            { root: root, rootMargin: '64px 0px 64px 0px', threshold: 0.01 }
          );
          nearGifs.forEach((img) => gifIo!.observe(img));
        }

        cleanup = () => {
          io?.disconnect();
          gifIo?.disconnect();
        };
      });

      return () => {
        cleanup?.();
      };
    }, [props.messages, gifPolicy]);

    const isMobile =
      typeof window !== 'undefined' &&
      ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        window.innerWidth <= 768 ||
        /android|iphone|ipad|ipod|iemobile|opera mini/i.test(
          (navigator.userAgent || '').toLowerCase()
        ));
    const scrollToBottomSmooth = useEvent(() => {
      containerRef.current?.scrollTo({ top: 0, behavior: isMobile ? 'auto' : 'smooth' });
    });
    const scrollToBottomAuto = useEvent(() => {
      containerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    });

    useEffect(() => {
      if (props.messages.length === 0) {
        return;
      }

      // 消息长度发生变化，滚动到底部
      if (lockRef.current === false) {
        const curConv = converseId;
        const isSwitch = prevConverseIdRef.current !== curConv;
        prevConverseIdRef.current = curConv;
        if (isSwitch || !firstRenderedRef.current) {
          firstRenderedRef.current = true;
          scrollToBottomAuto();
        } else {
          scrollToBottomSmooth();
        }
      }
    }, [props.messages.length, converseId]);

    useSharedEventHandler('sendMessage', scrollToBottomSmooth);

    const handleScroll = useEvent(() => {
      if (props.messages.length === 0) {
        return;
      }

      if (!containerRef.current) {
        return;
      }

      if (-containerRef.current.scrollTop <= bottomTriggerBuffer) {
        // 滚动到最底部
        lockRef.current = false;
        setShowScrollToBottom(false);
      } else if (
        -containerRef.current.scrollTop + containerRef.current.clientHeight >=
        containerRef.current.scrollHeight - topTriggerBuffer
      ) {
        // 滚动条碰触到最顶部
        props.onLoadMore();
      } else {
        // 滚动在中间
        // 锁定位置不自动滚动
        lockRef.current = true;
        setShowScrollToBottom(true);
      }
    });

    return (
      <div
        className="flex-1 overflow-y-scroll overflow-x-hidden flex flex-col-reverse"
        ref={containerRef}
        onScroll={handleScroll}
      >
        <div>
          {props.messages.map((message, index, arr) => {
            const isSelf = String(message.author || '') === selfId;
            const ackInfo = isSelf ? computeAckInfo(String(message._id)) : undefined;
            return (
              <React.Fragment key={String(message._id)}>
                {index === unreadDividerIndex && (
                  <Divider className="text-xs opacity-70 px-6 font-normal select-text">
                    —— {t('未读消息')} ——
                  </Divider>
                )}
                {buildMessageItemRow(arr, index, ackInfo)}
              </React.Fragment>
            );
          })}
        </div>

        {showScrollToBottom && <ScrollToBottom onClick={scrollToBottomSmooth} />}

        {/* 因为是倒过来的，因此要前面的要放在后面 */}
        {props.title && !props.hasMoreMessage && (
          <ChatMessageHeader title={props.title} />
        )}
      </div>
    );
  }
);
NormalMessageList.displayName = 'NormalMessageList';

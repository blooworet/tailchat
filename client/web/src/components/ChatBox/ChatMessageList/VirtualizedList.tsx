import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildMessageItemRow } from './Item';
import type { MessageListProps } from './types';
import {
  FollowOutputScalarType,
  Virtuoso,
  VirtuosoHandle,
} from 'react-virtuoso';
import { useMemoizedFn, useSharedEventHandler, useUserSettings } from 'tailchat-shared';
import { useAppSelector } from 'tailchat-shared/redux/hooks/useAppSelector';
import { useConverseAck } from 'tailchat-shared/redux/hooks/useConverseAck';
import type { ChatMessage } from 'tailchat-shared/model/message';
import { runInlineActionDecorators, tokenizeWithRangesCached } from '@/plugin/common/inline-actions';
import { setInlineActions, getInlineActions, setTokens, getTokens, clearCaches, buildMessageCacheSignature } from './parserCache';
import { ScrollToBottom } from './ScrollToBottom';

const PREPEND_OFFSET = 10 ** 7;

const virtuosoStyle: React.CSSProperties = {
  height: '100%',
};

const overscan = {
  main: 1000,
  reverse: 1000,
};

/**
 * 新版的虚拟列表
 * 参考: https://github.com/GetStream/stream-chat-react/blob/master/src/components/MessageList/VirtualizedMessageList.tsx
 */
export const VirtualizedMessageList: React.FC<MessageListProps> = React.memo(
  (props) => {
    const listRef = useRef<VirtuosoHandle>(null);
    const scrollerRef = useRef<HTMLElement>();
    const numItemsPrepended = usePrependedMessagesCount(props.messages);
    // Move hook to top-level to comply with Rules of Hooks
    const { settings } = useUserSettings();
    const gifPolicy = settings['telegram.gifPolicy'] ?? 'pauseOffscreen';
    const isMobile =
      typeof window !== 'undefined' &&
      ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
        window.innerWidth <= 768 ||
        /android|iphone|ipad|ipod|iemobile|opera mini/i.test(
          (navigator.userAgent || '').toLowerCase()
        ));

    const converseId = useAppSelector((state) => state.chat.currentConverseId) || '';
    const { updateConverseAck } = useConverseAck(converseId);
    const loadingMoreRef = useRef(false);
    const atBottomRef = useRef(true);

    const scrollToBottom = useMemoizedFn(() => {
      listRef.current?.scrollTo({
        top: scrollerRef.current?.scrollHeight,
        behavior: isMobile ? 'auto' : 'smooth',
      });
    });

    useSharedEventHandler('sendMessage', scrollToBottom);

    const handleLoadMore = useMemoizedFn(() => {
      if (props.isLoadingMore || loadingMoreRef.current) {
        return;
      }
      if (!props.hasMoreMessage) return;

      // Anchor capture (mobile-only): choose second visible item as anchor
      let anchorId: string | null = null;
      let anchorTop = 0;
      if (isMobile && lastRangeRef.current) {
        const virtToReal = (vIndex: number) => vIndex + numItemsPrepended - PREPEND_OFFSET;
        const candidateVirt = Math.min(
          lastRangeRef.current.endIndex,
          lastRangeRef.current.startIndex + 1
        );
        const realIndex = Math.max(0, Math.min(props.messages.length - 1, virtToReal(candidateVirt)));
        const m = props.messages[realIndex] as any;
        if (m && m._id) {
          anchorId = String(m._id);
          try {
            const root = scrollerRef.current as HTMLElement | undefined;
            const el = root?.querySelector?.(`[data-message-id="${anchorId}"]`) as HTMLElement | null;
            if (root && el) {
              const r1 = root.getBoundingClientRect();
              const r2 = el.getBoundingClientRect();
              anchorTop = r2.top - r1.top;
            }
          } catch {}
        }
      }

      loadingMoreRef.current = true;
      Promise.resolve(props.onLoadMore())
        .finally(() => {
          try {
            if (isMobile && anchorId) {
              const root = scrollerRef.current as HTMLElement | undefined;
              const el = root?.querySelector?.(`[data-message-id="${anchorId}"]`) as HTMLElement | null;
              if (root && el) {
                // measure after DOM updates
                requestAnimationFrame(() => {
                  try {
                    const r1n = root.getBoundingClientRect();
                    const r2n = el.getBoundingClientRect();
                    const newTop = r2n.top - r1n.top;
                    const delta = newTop - anchorTop;
                    if (Math.abs(delta) > 0) {
                      root.scrollTop += delta;
                    }
                  } catch {}
                });
              }
            }
          } catch {}
          loadingMoreRef.current = false;
        });
    });

    const followOutput = useMemoizedFn(
      (isAtBottom: boolean): FollowOutputScalarType => {
        if (isAtBottom && !isMobile) {
          setTimeout(() => {
            listRef.current?.autoscrollToBottom();
          }, 20);
        }
        return isMobile ? false : isAtBottom ? 'smooth' : false;
      }
    );

    const computeItemKey = useMemoizedFn(
      (index: number, item?: ChatMessage) => {
        if (!item) return index;
        const content = String((item as any).content || '');
        const up = String((item as any).updatedAt || '');
        const metaInlineForKey: any = (item as any)?.meta?.inlineActions || null;
        const inlineSig = metaInlineForKey && typeof metaInlineForKey === 'object'
          ? String(metaInlineForKey.signature ||
              JSON.stringify({
                a: Array.isArray(metaInlineForKey.actions) ? metaInlineForKey.actions : [],
                r: Array.isArray(metaInlineForKey.ranges) ? metaInlineForKey.ranges : [],
                k: Array.isArray(metaInlineForKey.keyboard) ? metaInlineForKey.keyboard : [],
              }))
          : '';
        const editedFlag = String((item as any).isEdited ? 1 : 0);
        const sig = buildMessageCacheSignature(content, up, inlineSig);
        return `${item._id}:${sig}:${editedFlag}`;
      }
    );

    const itemContent = useMemoizedFn((virtuosoIndex: number, _item?: ChatMessage) => {
      const index = virtuosoIndex + numItemsPrepended - PREPEND_OFFSET;
      return buildMessageItemRow(props.messages, index);
    });

    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const lastRangeRef = useRef<{ startIndex: number; endIndex: number } | null>(null);
    const atBottomStateChange = useMemoizedFn((atBottom: boolean) => {
      atBottomRef.current = atBottom;
      if (atBottom) {
        setShowScrollToBottom(false);
      } else {
        setShowScrollToBottom(true);
      }
    });

    const onRangeChanged = useMemoizedFn((range: { startIndex: number; endIndex: number }) => {
      if (!isMobile) return;
      lastRangeRef.current = range;
      const virtToReal = (vIndex: number) => vIndex + numItemsPrepended - PREPEND_OFFSET;
      let start = virtToReal(range.startIndex);
      let end = virtToReal(range.endIndex);
      start = Math.max(0, start);
      end = Math.min(props.messages.length - 1, end);
      if (start > end) return;

      let maxId = '';
      for (let i = start; i <= end; i++) {
        const m = props.messages[i] as any;
        if (!m || m.isLocal === true) continue;
        const id = String(m._id || '');
        if (id && id > maxId) maxId = id;
      }
      if (maxId) updateConverseAck(maxId);
    });

    // Precompute inline actions and tokens for mobile
    useEffect(() => {
      if (!isMobile) return;
      try {
        for (const m of props.messages) {
          const id = String((m as any)._id || '');
          if (!id) continue;
          const content = String((m as any).content || '');
          const updatedAt = String((m as any).updatedAt || '');
          const metaInlineForSig: any = (m as any)?.meta?.inlineActions || null;
          const inlineSig = metaInlineForSig && typeof metaInlineForSig === 'object'
            ? String(metaInlineForSig.signature ||
                JSON.stringify({
                  a: Array.isArray(metaInlineForSig.actions) ? metaInlineForSig.actions : [],
                  r: Array.isArray(metaInlineForSig.ranges) ? metaInlineForSig.ranges : [],
                  k: Array.isArray(metaInlineForSig.keyboard) ? metaInlineForSig.keyboard : [],
                }))
            : '';
          const sig = buildMessageCacheSignature(content, updatedAt, inlineSig);
          if (!getInlineActions(id, sig) || !getTokens(id, sig)) {
            let metaInline: any = ((m as any).meta || ({} as any)).inlineActions;
            if (!metaInline) {
              const decorated = runInlineActionDecorators(content);
              if (decorated) metaInline = decorated as any;
            }
            if (metaInline) setInlineActions(id, metaInline, sig);
            const ranges = (metaInline && metaInline.ranges) || [];
            const nodes = tokenizeWithRangesCached(content, ranges);
            setTokens(id, nodes, sig);
          }
        }
      } catch {}
    }, [isMobile, props.messages]);

    // When at bottom and new messages arrive on mobile, auto-adhere to bottom
    useEffect(() => {
      if (!isMobile) return;
      if (!atBottomRef.current) return;
      const t = setTimeout(() => {
        try {
          listRef.current?.scrollTo({
            top: scrollerRef.current?.scrollHeight,
            behavior: 'auto',
          });
        } catch {}
      }, 0);
      return () => clearTimeout(t);
    }, [isMobile, props.messages.length]);

    // Clear caches when unmounting this list (switching converses)
    useEffect(() => {
      return () => {
        try { clearCaches(); } catch {}
      };
    }, []);

    // Enhance media performance in virtualized scroller: hint img lazy/decoding
    useEffect(() => {
      const root = scrollerRef.current;
      if (!root) return;

      const imgs = root.querySelectorAll<HTMLImageElement>('img');
      imgs.forEach((img) => {
        if (!img.getAttribute('loading')) img.setAttribute('loading', 'lazy');
        if (!img.getAttribute('decoding')) img.setAttribute('decoding', 'async');
        if (isMobile && img.closest('.chat-message-item_body')) {
          // LQIP placeholder on mobile for visible/nearby images
          const alreadyLoaded = (img as any).complete && (img as any).naturalWidth > 0;
          if (!alreadyLoaded && img.dataset.lqip !== '1') {
            try {
              const container = root.getBoundingClientRect();
              const targetWidth = Math.max(0, Math.min(img.clientWidth || (container.width - 24), container.width));
              const wAttr = Number(img.getAttribute('width') || '0');
              const hAttr = Number(img.getAttribute('height') || '0');
              let ph = 0;
              if (wAttr > 0 && hAttr > 0 && targetWidth > 0) {
                ph = Math.round((targetWidth * hAttr) / wAttr);
              } else {
                ph = Math.max(120, Math.floor((targetWidth || 280) * 0.56)); // fallback 16:9
              }
              img.dataset.lqip = '1';
              (img.style as any).backgroundColor = 'rgba(0,0,0,0.06)';
              (img.style as any).minHeight = ph + 'px';
              const onDone = () => {
                try {
                  delete img.dataset.lqip;
                  (img.style as any).minHeight = '';
                  (img.style as any).backgroundColor = '';
                  img.removeEventListener('load', onDone);
                  img.removeEventListener('error', onDone);
                } catch {}
              };
              img.addEventListener('load', onDone);
              img.addEventListener('error', onDone);
            } catch {}
          }
        }
      });
    }, [props.messages.length]);

    // Pause offscreen videos/GIFs according to user settings
    useEffect(() => {
      const root = scrollerRef.current;
      if (!root) return;

      const vids = root.querySelectorAll<HTMLVideoElement>('video');
      const imgs = root.querySelectorAll<HTMLImageElement>('img');
      const animatedImgs = Array.from(imgs).filter((img) => /\.gif($|\?)/i.test(img.src));

      const videoIo = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const v = entry.target as HTMLVideoElement;
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
      vids.forEach((v) => videoIo.observe(v));

      let gifIo: IntersectionObserver | null = null;
      if (!isMobile && animatedImgs.length > 0 && gifPolicy === 'pauseOffscreen') {
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
        animatedImgs.forEach((img) => gifIo!.observe(img));
      }

      return () => {
        videoIo.disconnect();
        if (gifIo) gifIo.disconnect();
      };
    }, [props.messages.length, gifPolicy, isMobile]);

    return (
      <div className="flex-1">
        <Virtuoso
          style={virtuosoStyle}
          ref={listRef}
          scrollerRef={(ref) => (scrollerRef.current = ref as HTMLElement)}
          data={props.messages}
          firstItemIndex={PREPEND_OFFSET - numItemsPrepended}
          initialTopMostItemIndex={Math.max(props.messages.length - 1, 0)}
          computeItemKey={computeItemKey}
          totalCount={props.messages.length}
          overscan={isMobile ? { main: 200, reverse: 200 } : overscan}
          itemContent={itemContent}
          alignToBottom={true}
          startReached={handleLoadMore}
          atBottomStateChange={atBottomStateChange}
          rangeChanged={onRangeChanged}
          followOutput={isMobile ? false : followOutput}
          defaultItemHeight={25}
          atTopThreshold={100}
          atBottomThreshold={40}
          useWindowScroll={false}
        />

        {showScrollToBottom && <ScrollToBottom onClick={scrollToBottom} />}
      </div>
    );
  }
);
VirtualizedMessageList.displayName = 'VirtualizedMessageList';

function usePrependedMessagesCount(messages: ChatMessage[]) {
  const currentFirstMessageId = messages?.[0]?._id;
  const firstMessageId = useRef(currentFirstMessageId);
  const earliestMessageId = useRef(currentFirstMessageId);
  const previousNumItemsPrepended = useRef(0);

  const numItemsPrepended = useMemo(() => {
    if (!messages || !messages.length) {
      return 0;
    }
    // if no new messages were prepended, return early (same amount as before)
    if (currentFirstMessageId === earliestMessageId.current) {
      return previousNumItemsPrepended.current;
    }

    if (!firstMessageId.current) {
      firstMessageId.current = currentFirstMessageId;
    }
    earliestMessageId.current = currentFirstMessageId;
    // if new messages were prepended, find out how many
    // start with this number because there cannot be fewer prepended items than before
    for (
      let i = previousNumItemsPrepended.current;
      i < messages.length;
      i += 1
    ) {
      if (messages[i]._id === firstMessageId.current) {
        previousNumItemsPrepended.current = i;
        return i;
      }
    }
    return 0;
    // TODO: there's a bug here, the messages prop is the same array instance (something mutates it)
    // that's why the second dependency is necessary
  }, [messages, messages?.length]);

  return numItemsPrepended;
}

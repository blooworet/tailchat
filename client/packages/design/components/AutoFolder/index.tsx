import React, {
  PropsWithChildren,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMemoizedFn } from 'ahooks';

interface AutoFolderProps extends PropsWithChildren {
  maxHeight: number;
  showFullText?: React.ReactNode;
  backgroundColor?: string;
}
export const AutoFolder: React.FC<AutoFolderProps> = React.memo((props) => {
  const { showFullText = 'More', backgroundColor = 'white' } = props;
  const [isShowFullBtn, setIsShowFullBtn] = useState(false); // 是否显示展示所有内容的按钮
  const [isShowFull, setIsShowFull] = useState(false); // 是否点击按钮展示所有
  const contentRef = useRef<HTMLDivElement>(null);
  const [dynamicMaxHeight, setDynamicMaxHeight] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return Math.round(window.innerHeight * 0.6);
    }
    return props.maxHeight;
  });

  // 根据窗口高度动态更新最大高度（约为视口高度的 60%）
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleResize = () => {
      setDynamicMaxHeight(Math.round(window.innerHeight * 0.6));
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [props.maxHeight]);

  // 监听内容高度，当内容超过当前最大高度时展示“展开更多”按钮
  useEffect(() => {
    if (!contentRef.current) {
      return;
    }

    const observer = new window.ResizeObserver((entries) => {
      if (!entries[0]) {
        return;
      }

      const { height } = entries[0].contentRect;

      if (height > dynamicMaxHeight) {
        setIsShowFull(false);
        setIsShowFullBtn(true);

        observer.disconnect(); // 触发一次则解除连接
      }
    });
    observer.observe(contentRef.current);

    return () => {
      observer.disconnect();
    };
  }, [dynamicMaxHeight]);

  const maxHeight = useMemo(() => {
    if (isShowFull) {
      return 'none';
    } else {
      return dynamicMaxHeight;
    }
  }, [isShowFull, dynamicMaxHeight]);

  const handleClickShowFullBtn = useMemoizedFn(() => {
    setIsShowFullBtn(false);
    setIsShowFull(true);
  });

  return (
    <div
      style={{
        maxHeight,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div ref={contentRef}>{props.children}</div>

      {isShowFullBtn && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            textAlign: 'center',
            cursor: 'pointer',
            backgroundImage: `linear-gradient(rgba(0,0,0,0), ${backgroundColor})`,
            padding: '4px 0',
          }}
          onClick={handleClickShowFullBtn}
        >
          {showFullText}
        </div>
      )}
    </div>
  );
});
AutoFolder.displayName = 'AutoFolder';

/**
 * 声纹音频播放器组件
 * 基于Telegram TT的实现 (telegram-tt/src/components/common/Audio.tsx)
 * 
 * 核心功能：
 * - 完整的音频播放控制逻辑
 * - 声纹Canvas与播放进度同步
 * - 播放按钮状态动画（播放/暂停/加载）
 * - 拖拽seek功能实现
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { Icon } from 'tailchat-design';
import { showErrorToasts } from 'tailchat-shared';

// 暂时使用硬编码字符串，避免导入问题
const t = (key: string) => key;
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { renderWaveform } from './WaveformRenderer';
import { interpolateArray, isValidWaveform } from '../../utils/waveform';
// import './VoiceMessagePlayer.scss'; // 暂时注释，项目使用Less不是Scss

export interface VoiceMessagePlayerProps {
  audioUrl: string;
  duration: number;
  waveform?: number[];          // 波形数据数组
  isOwn?: boolean;             // 是否为自己发送的消息
  theme?: 'light' | 'dark' | 'miku' | 'telegram';
  className?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onError?: (error: string) => void;
}

// 获取设备和屏幕相关的波形配置
function getWaveformSpikeConfig(isMobile: boolean = false): { minSpikes: number; maxSpikes: number } {
  // 基于Telegram TT的配置
  const isSmallScreen = window.innerWidth <= 375;
  const isMediumScreen = window.innerWidth <= 410;

  if (isMobile) {
    if (isSmallScreen) {
      return { minSpikes: 16, maxSpikes: 35 };
    }
    if (isMediumScreen) {
      return { minSpikes: 20, maxSpikes: 40 };
    }
    return { minSpikes: 20, maxSpikes: 45 };
  }
  
  return { minSpikes: 25, maxSpikes: 75 };
}

// 主题颜色配置
const THEME_COLORS = {
  light: {
    background: 'rgba(243, 244, 246, 0.8)',
    border: 'rgba(209, 213, 219, 1)',
    waveform: {
      fill: '#ADD3F7',
      progressFill: '#3390EC',
      ownFill: '#AEDFA4',
      ownProgressFill: '#4FAE4E',
    },
    text: 'rgba(31, 41, 55, 1)',
    button: {
      background: '#3390EC',
      hover: '#2563EB',
    },
  },
  dark: {
    background: 'rgba(31, 41, 55, 0.8)',
    border: 'rgba(75, 85, 99, 1)',
    waveform: {
      fill: '#494A78',
      progressFill: '#8774E1',
      ownFill: '#B7ABED',
      ownProgressFill: '#FFFFFF',
    },
    text: 'rgba(243, 244, 246, 1)',
    button: {
      background: '#8774E1',
      hover: '#7C3AED',
    },
  },
  miku: {
    background: 'rgba(57, 197, 187, 0.1)',
    border: 'rgba(57, 197, 187, 0.3)',
    waveform: {
      fill: 'rgba(57, 197, 187, 0.5)',
      progressFill: '#39C5BB',
      ownFill: 'rgba(57, 197, 187, 0.7)',
      ownProgressFill: '#2DD4BF',
    },
    text: '#39C5BB',
    button: {
      background: '#39C5BB',
      hover: '#2DD4BF',
    },
  },
  telegram: {
    background: 'rgba(74, 162, 242, 0.1)',
    border: 'rgba(74, 162, 242, 0.3)',
    waveform: {
      fill: 'rgba(74, 162, 242, 0.5)',
      progressFill: '#4aa2f2',
      ownFill: 'rgba(74, 162, 242, 0.7)',
      ownProgressFill: '#0088cc',
    },
    text: '#4aa2f2',
    button: {
      background: '#4aa2f2',
      hover: '#0088cc',
    },
  },
} as const;

export const VoiceMessagePlayer = React.memo(({
  audioUrl,
  duration,
  waveform,
  isOwn = false,
  theme = 'light',
  className = '',
  onPlay,
  onPause,
  onEnded,
  onError,
}: VoiceMessagePlayerProps) => {
  const waveformCanvasRef = useRef(null as HTMLCanvasElement | null);
  const seekerRef = useRef(null as HTMLDivElement | null);
  const [isUserSeeking, setIsUserSeeking] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // 音频播放器
  const {
    state,
    play,
    pause,
    playPause,
    seekToProgress,
    load,
  } = useAudioPlayer({
    volume: 1.0,
    playbackRate: 1.0,
  });

  // 处理波形数据
  const processedWaveform = useMemo(() => {
    if (!waveform || !isValidWaveform(waveform)) {
      // 创建默认波形数据
      const defaultLength = Math.min(duration, 30);
      return {
        spikes: new Array(defaultLength).fill(0),
        peak: 0,
      };
    }

    const isMobile = window.innerWidth <= 768;
    const { minSpikes, maxSpikes } = getWaveformSpikeConfig(isMobile);
    
    // 根据duration调整spikes数量
    const durationFactor = Math.min(duration / 10, 1); // 假设平均语音长度为10秒
    const targetSpikes = Math.round(minSpikes + (maxSpikes - minSpikes) * durationFactor);
    
    return interpolateArray(waveform, targetSpikes);
  }, [waveform, duration]);

  // 获取主题颜色
  const colors = useMemo(() => {
    const themeColors = THEME_COLORS[theme as keyof typeof THEME_COLORS] || THEME_COLORS.light;
    return {
      fillStyle: isOwn ? themeColors.waveform.ownFill : themeColors.waveform.fill,
      progressFillStyle: isOwn ? themeColors.waveform.ownProgressFill : themeColors.waveform.progressFill,
    };
  }, [theme, isOwn]);

  // 加载音频
  useEffect(() => {
    if (audioUrl) {
      load(audioUrl);
    }
  }, [audioUrl, load]);

  // 播放状态回调
  useEffect(() => {
    if (state.isPlaying && onPlay) {
      onPlay();
    } else if (!state.isPlaying && onPause) {
      onPause();
    }
  }, [state.isPlaying, onPlay, onPause]);

  // 播放结束回调
  useEffect(() => {
    if (state.playProgress >= 1 && onEnded) {
      onEnded();
    }
  }, [state.playProgress, onEnded]);

  // 错误处理
  useEffect(() => {
    if (state.isError && state.error) {
      showErrorToasts(state.error);
      if (onError) {
        onError(state.error);
      }
    }
  }, [state.isError, state.error, onError]);

  // 🎯 渲染波形 - 解决Canvas坐标系统和重渲染问题
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !processedWaveform.spikes.length) {
      return;
    }

    // 🔧 确保Canvas在DOM中且已完成布局
    const containerElement = canvas.parentElement;
    if (!containerElement || containerElement.clientWidth === 0) {
      console.warn('[VoicePlayer] Canvas容器未准备好，延迟渲染');
      return;
    }

    // 🎯 修复播放进度显示逻辑
    const displayProgress = isUserSeeking ? state.playProgress : state.playProgress;

    // 🔧 使用 requestAnimationFrame 确保DOM更新完成
    const renderFrame = () => {
      // 重新获取最新的容器宽度，避免缓存问题
      const currentContainerWidth = containerElement.clientWidth;
      
      try {
        renderWaveform({
          canvas,
          spikes: processedWaveform.spikes,
          progress: displayProgress,
          peak: Math.max(processedWaveform.peak, 1),
          colors,
          containerWidth: currentContainerWidth,
          config: {
            height: 30,
            spikeWidth: 2,
            spikeStep: 4,
            spikeRadius: 1,
            minSpikeHeight: 2,
          }
        });
      } catch (error) {
        console.error('[VoicePlayer] 波形渲染失败:', error);
      }
    };

    const frameId = requestAnimationFrame(renderFrame);
    
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [processedWaveform, state.playProgress, colors, isUserSeeking]);

  // 🎯 响应式Canvas尺寸监听 - 解决坐标系变化问题
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;

    let resizeTimeout: NodeJS.Timeout | null = null;

    const resizeObserver = new ResizeObserver((entries) => {
      // 🔧 防抖处理，避免频繁重新渲染
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      
      resizeTimeout = setTimeout(() => {
        if (processedWaveform.spikes.length > 0) {
          const containerElement = canvas.parentElement;
          const containerWidth = containerElement ? containerElement.clientWidth : 0;
          
          if (containerWidth > 0) {
            try {
              renderWaveform({
                canvas,
                spikes: processedWaveform.spikes,
                progress: state.playProgress,
                peak: Math.max(processedWaveform.peak, 1),
                colors,
                containerWidth,
                config: {
                  height: 30,
                  spikeWidth: 2,
                  spikeStep: 4,
                  spikeRadius: 1,
                  minSpikeHeight: 2,
                }
              });
            } catch (error) {
              console.error('[VoicePlayer] 响应式渲染失败:', error);
            }
          }
        }
      }, 16); // ~60fps
    });

    const container = canvas.parentElement;
    if (container) {
      resizeObserver.observe(container);
    }

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeObserver.disconnect();
    };
  }, [processedWaveform, colors, state.playProgress]);

  // 处理播放按钮点击
  const handlePlayPause = useCallback(() => {
    playPause();
  }, [playPause]);

  // 🎯 统一的点击处理逻辑 - 解决事件冲突和状态陷阱
  const handleSeek = useCallback((clientX: number) => {
    // 🔧 确保DOM引用有效且持续可用
    const container = seekerRef.current;
    if (!container || state.duration === 0) {
      console.warn('[VoicePlayer] DOM引用无效或音频未加载', { container, duration: state.duration });
      return false;
    }

    // 🎯 获取当前准确的边界信息，避免缓存问题
    const rect = container.getBoundingClientRect();
    if (rect.width === 0) {
      console.warn('[VoicePlayer] 容器宽度为0，跳过处理');
      return false;
    }

    const x = clientX - rect.left;
    const progress = Math.max(0, Math.min(1, x / rect.width));
    
    // 🔧 使用最新的seekToProgress引用，避免闭包陈旧
    try {
      seekToProgress(progress);
      return true;
    } catch (error) {
      console.error('[VoicePlayer] seekToProgress 执行失败:', error);
      return false;
    }
  }, [state.duration, seekToProgress]);

  // 🎯 纯点击处理 - 移除onMouseDown，避免事件冲突
  const handleWaveformClick = useCallback((e: MouseEvent) => {
    // 🚨 防止与拖拽事件冲突
    if (isDragging) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    handleSeek(e.clientX);
  }, [isDragging, handleSeek]);

  // 🎯 拖拽处理 - 独立于点击事件
  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return; // 只处理左键
    
    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
    setIsUserSeeking(true);
    
    // 🔧 立即处理第一次位置
    const success = handleSeek(e.clientX);
    if (!success) {
      setIsDragging(false);
      setIsUserSeeking(false);
      return;
    }

    // 🎯 拖拽移动处理 - 使用最新的引用
    const handleMouseMove = (moveEvent: MouseEvent) => {
      handleSeek(moveEvent.clientX);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsUserSeeking(false);
      
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [handleSeek]);

  // 格式化时间显示
  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // 计算显示的时间
  const displayTime = useMemo(() => {
    if (state.isPlaying && state.playProgress > 0) {
      return formatTime(state.currentTime);
    }
    return formatTime(duration);
  }, [state.isPlaying, state.playProgress, state.currentTime, duration, formatTime]);

  return (
    <div className={`voice-message-player voice-message-player--${theme} ${isOwn ? 'voice-message-player--own' : ''} ${className}`}>
      {/* 播放按钮 */}
      <div className="voice-message-player__button">
        <button
          className={`voice-message-player__play-btn ${state.isPlaying ? 'voice-message-player__play-btn--playing' : ''} ${state.isLoading ? 'voice-message-player__play-btn--loading' : ''}`}
          onClick={handlePlayPause}
          disabled={state.isLoading || state.isError}
          aria-label={state.isPlaying ? t('暂停') : t('播放')}
        >
          {state.isLoading ? (
            <Icon icon="mdi:loading mdi-spin" className="voice-message-player__icon" />
          ) : state.isPlaying ? (
            <Icon icon="mdi:pause" className="voice-message-player__icon" />
          ) : (
            <Icon icon="mdi:play" className="voice-message-player__icon" />
          )}
          
          {/* 播放时的脉动效果 */}
          {state.isPlaying && (
            <div className="voice-message-player__pulse-ring" />
          )}
        </button>
      </div>

      {/* 波形和时间容器 */}
      <div className="voice-message-player__content">
        {/* 波形显示 */}
        <div 
          className="voice-message-player__waveform-container"
          ref={seekerRef}
          onMouseDown={handleMouseDown}
          onClick={handleWaveformClick}
          style={{
            touchAction: 'none', // 防止移动设备上的滚动干扰
            userSelect: 'none',  // 防止文本选择干扰
          }}
        >
          <canvas
            ref={waveformCanvasRef}
            className={`voice-message-player__waveform ${isDragging ? 'voice-message-player__waveform--dragging' : ''}`}
          />
          
          {/* 加载状态覆盖层 */}
          {(state.isLoading || state.isError) && (
            <div className="voice-message-player__overlay">
              {state.isLoading && (
                <span className="voice-message-player__overlay-text">
                  {t('加载中...')}
                </span>
              )}
              {state.isError && (
                <span className="voice-message-player__overlay-text voice-message-player__overlay-text--error">
                  {t('播放失败')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 时间显示 */}
        <div className="voice-message-player__time">
          {displayTime}
        </div>
      </div>
    </div>
  );
});

VoiceMessagePlayer.displayName = 'VoiceMessagePlayer';

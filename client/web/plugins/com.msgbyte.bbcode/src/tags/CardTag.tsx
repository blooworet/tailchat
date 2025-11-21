import { Card } from '@capital/component';
import React from 'react';
import type { TagProps } from '../bbcode/type';

// 🎯 内联Telegram波形处理算法 - 避免外部模块依赖
const AVG_VOICE_DURATION = 10;
const SPIKE_CONFIG = {
  desktop: { MIN: 25, MAX: 75 },
  mobile: { MIN: 16, MAX: 45 },
  tiny: { MIN: 16, MAX: 35 },
};

function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         window.innerWidth <= 768;
}

function getSeeklineSpikeAmounts(isMobile: boolean = false): { MIN_SPIKES: number; MAX_SPIKES: number } {
  const isTinyScreen = window.innerWidth <= 375;
  
  if (isMobile) {
    return isTinyScreen 
      ? { MIN_SPIKES: SPIKE_CONFIG.tiny.MIN, MAX_SPIKES: SPIKE_CONFIG.tiny.MAX }
      : { MIN_SPIKES: SPIKE_CONFIG.mobile.MIN, MAX_SPIKES: SPIKE_CONFIG.mobile.MAX };
  }
  
  return { MIN_SPIKES: SPIKE_CONFIG.desktop.MIN, MAX_SPIKES: SPIKE_CONFIG.desktop.MAX };
}

function interpolateArray(data: number[], fitCount: number): { data: number[]; peak: number } {
  if (!data || data.length === 0) {
    return { data: new Array(fitCount).fill(0), peak: 0 };
  }
  
  if (data.length === fitCount) {
    const peak = Math.max(...data);
    return { data: [...data], peak };
  }

  let peak = 0;
  const newData = new Array(fitCount);
  const springFactor = data.length / fitCount;
  const leftFiller = data[0];
  const rightFiller = data[data.length - 1];
  
  for (let i = 0; i < fitCount; i++) {
    const idx = Math.floor(i * springFactor);
    // 使用3点平均插值，保持波形平滑
    const val = ((data[idx - 1] ?? leftFiller) + (data[idx] ?? leftFiller) + (data[idx + 1] ?? rightFiller)) / 3;
    newData[i] = val;
    if (peak < val) {
      peak = val;
    }
  }
  
  return { data: newData, peak };
}

function calculateOptimalSpikeCount(duration: number, isMobile: boolean = false): number {
  const { MIN_SPIKES, MAX_SPIKES } = getSeeklineSpikeAmounts(isMobile);
  const durationFactor = Math.min(duration / AVG_VOICE_DURATION, 1);
  const spikesCount = Math.round(MIN_SPIKES + (MAX_SPIKES - MIN_SPIKES) * durationFactor);
  
  return spikesCount;
}

function processWaveformForDisplay(
  waveform: number[], 
  duration: number, 
  isMobile: boolean = false
): { spikes: number[]; peak: number } {
  if (!waveform || waveform.length === 0) {
    const defaultLength = Math.min(duration, 30);
    return {
      spikes: new Array(defaultLength).fill(0),
      peak: 0,
    };
  }

  const optimalSpikeCount = calculateOptimalSpikeCount(duration, isMobile);
  const result = interpolateArray(waveform, optimalSpikeCount);
  
  return { spikes: result.data, peak: result.peak };
}

export const CardTag: React.FC<TagProps> = React.memo((props) => {
  try {
    const { node } = props;
    const label = node.content.join('');
    const attrs = node.attrs ?? {};

    const payload: any = {
      label,
      ...attrs,
    };

    // 特殊处理音频类型卡片
    if (payload.type === 'audio') {
    const audioUrl = payload.url;
    const duration = payload.duration ? parseFloat(payload.duration) : 0;

    const waveformData = payload.waveform ? 
      (typeof payload.waveform === 'string' ? 
        (() => {
          try {
            // 处理Base64编码的waveform数据
            let decodedJson: string;
            try {
              // 尝试Base64解码（新格式）
              decodedJson = atob(payload.waveform);
            } catch (base64Error) {
              // 降级：直接处理JSON字符串（旧格式兼容）
              decodedJson = payload.waveform.replace(/&quot;/g, '"');
            }
            
            const parsed = JSON.parse(decodedJson);
            return parsed;
          } catch (error) {
            console.error('  ❌ 波形数据解析失败:', error);
            console.error('  🔍 原始数据:', payload.waveform);
            return null;
          }
        })() : payload.waveform
      ) : null;
    
    if (!audioUrl) {
      return <span className="text-red-500 text-sm">[音频消息格式错误]</span>;
    }

    // 使用内联的声纹播放器实现，避免插件系统路径问题
    return <VoiceMessagePlayerInline 
      audioUrl={audioUrl} 
      duration={duration} 
      waveform={waveformData} 
    />;
  }

  return <Card type={payload.type} payload={payload} />;
  } catch (error) {
    console.error('❌ [CardTag] 渲染错误:', error);
    console.error('  节点数据:', props.node);
    return <span className="text-red-500 text-sm">[卡片渲染失败: {String(error)}]</span>;
  }
});
CardTag.displayName = 'CardTag';

// 内联声纹播放器组件，避免插件系统的路径解析问题
const VoiceMessagePlayerInline: React.FC<{
  audioUrl: string;
  duration: number;
  waveform?: number[] | null;
}> = React.memo(({ audioUrl, duration, waveform }) => {
  try {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  // 使用Telegram优化策略处理波形数据
  const processedWaveform = React.useMemo(() => {
    if (!waveform || !Array.isArray(waveform) || waveform.length === 0) {
      return { spikes: [], peak: 0 };
    }
    
    // 使用Telegram的优化算法处理波形
    const result = processWaveformForDisplay(waveform, duration, isMobileDevice());
    
    return result;
  }, [waveform, duration, audioUrl]);

  // 播放/暂停切换
  const togglePlayback = React.useCallback(async () => {
    if (!audioRef.current) return;

    try {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        setIsLoading(true);
        await audioRef.current.play();
      }
    } catch (error) {
      console.error('Audio playback error:', error);
      setIsLoading(false);
    }
  }, [isPlaying]);

  // 处理音频事件
  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handleLoadStart = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('canplay', handleCanPlay);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('canplay', handleCanPlay);
    };
  }, []);

  // 🎵 Telegram风格波形渲染 - 根据容器宽度聚合采样（不裁剪、不随意改变长度）
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const { spikes, peak } = processedWaveform;
    
    if (!canvas || !spikes || spikes.length === 0) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    // 🎯 基于容器宽度聚合采样，保持波形语义：
    // - 当数据点远多于像素宽度时：按列(max/peak)聚合，避免“过度挤压”但不丢语义
    // - 当数据点少于像素宽度时：按比例拉伸（小数坐标），不强制补点
    const containerElement = canvas.parentElement;
    const containerWidth = containerElement ? containerElement.clientWidth : 280;
    const HEIGHT = 24; // Canvas高度
    // 关键修复：不再在每次渲染时减去固定 padding，避免递归收缩
    const width = Math.max(containerWidth, 1);
    const dpr = (window.devicePixelRatio || 1);

    // 设置绘图尺寸（Retina清晰）
    canvas.width = Math.max(1, width * dpr);
    canvas.height = HEIGHT * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${HEIGHT}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 基于容器宽度进行聚合采样
    const aggregateSpikes = (input: number[], outWidth: number): number[] => {
      const out: number[] = new Array(outWidth);
      const step = input.length / outWidth;
      for (let x = 0; x < outWidth; x++) {
        const start = Math.floor(x * step);
        const end = Math.max(start + 1, Math.floor((x + 1) * step));
        let m = 0;
        for (let i = start; i < end && i < input.length; i++) {
          const v = input[i] || 0;
          if (v > m) m = v;
        }
        out[x] = m;
      }
      return out;
    };

    const displaySpikes = aggregateSpikes(spikes, width);

    const progress = duration > 0 ? currentTime / duration : 0;

    // 🎨 绘制：一列一像素，使用聚合后的峰值；不改变语义、不截断
    for (let x = 0; x < width; x++) {
      const spike = displaySpikes[x] || 0;
      const isActive = (x / width) < progress;
      ctx.globalAlpha = isActive ? 1 : 0.5;
      ctx.fillStyle = isActive ? '#3390EC' : 'rgba(51, 144, 236, 0.6)';

      const normalizedAmplitude = peak > 0 ? spike / peak : 0;
      const h = Math.max(2, HEIGHT * normalizedAmplitude);
      const y = (HEIGHT - h) / 2;
      // 采用 1px 列绘制，避免“过于紧凑”的宽条，视觉更清晰
      ctx.fillRect(x, y, 1, h);
    }
  }, [processedWaveform, currentTime, duration]);

  // 🎯 监听容器大小变化，重新渲染Canvas
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver(() => {
      // 触发重新渲染
      const event = new Event('resize');
      window.dispatchEvent(event);
    });

    const container = canvas.parentElement;
    if (container) {
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // 🎨 圆角矩形绘制函数（基于Telegram实现）
  const drawRoundedRect = (
    ctx: CanvasRenderingContext2D, 
    x: number, 
    y: number, 
    width: number, 
    height: number, 
    radius: number
  ) => {
    if (width < 2 * radius) radius = width / 2;
    if (height < 2 * radius) radius = height / 2;

    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  };

  // 处理Canvas点击
  const handleCanvasClick = React.useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audioRef.current || duration === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / rect.width;
    const targetTime = Math.max(0, Math.min(duration, progress * duration));
    
    audioRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  }, [duration]);

  // 处理进度条点击
  const handleProgressClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || duration === 0) return;

    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / rect.width;
    const targetTime = Math.max(0, Math.min(duration, progress * duration));
    
    audioRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  }, [duration]);

  // 格式化时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div 
      className="flex items-center gap-3 p-3 rounded-lg max-w-xs my-1 transition-colors"
      style={{
        backgroundColor: 'var(--tc-audio-bg, rgba(243, 244, 246, 0.8))',
        border: '1px solid var(--tc-audio-border, rgba(209, 213, 219, 1))',
        color: 'var(--tc-audio-text, rgba(31, 41, 55, 1))',
      }}
    >
      <audio ref={audioRef} src={audioUrl} preload="metadata" />
      
      {/* 播放按钮 */}
      <button
        onClick={togglePlayback}
        disabled={isLoading}
        className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-all hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500"
        style={{
          backgroundColor: 'var(--tc-audio-btn-bg, #3390EC)',
        }}
      >
        {isLoading ? (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : isPlaying ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>

      {/* 内容区 */}
      <div className="flex-1 min-w-0">
        {/* 波形或进度条 */}
        {(() => {
          const { spikes } = processedWaveform;
          const hasWaveform = spikes && spikes.length > 0;
          
          if (hasWaveform) {
            return (
              <canvas
                ref={canvasRef}
                className="cursor-pointer rounded"
                style={{ 
                  height: '24px', 
                  width: '100%',     /* 🎯 强制充满容器宽度 */
                  display: 'block'   /* 🎯 避免inline产生的额外空间 */
                }}
                onClick={handleCanvasClick}
              />
            );
          } else {
            return (
              <div 
                className="h-1 rounded-full cursor-pointer"
                style={{ backgroundColor: 'rgba(0, 0, 0, 0.1)' }}
                onClick={handleProgressClick}
              >
                <div
                  className="h-full rounded-full transition-all duration-100"
                  style={{
                    backgroundColor: 'var(--tc-audio-waveform-progress, #3390EC)',
                    width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                  }}
                />
              </div>
            );
          }
        })()}
        
        {/* 时间显示 */}
        <div className="text-xs mt-1" style={{ color: 'var(--tc-audio-text-secondary, rgba(107, 114, 128, 1))' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>
    </div>
  );
  } catch (error) {
    console.error('❌ [VoiceMessagePlayerInline] 渲染错误:', error);
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 text-red-600">
        <span className="text-sm">[音频播放器渲染失败: {String(error)}]</span>
      </div>
    );
  }
});

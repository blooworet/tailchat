/**
 * 音频播放Hook
 * 基于Telegram TT的实现 (telegram-tt/src/hooks/useAudioPlayer.ts)
 * 
 * 核心功能：
 * - 音频播放状态管理
 * - 进度更新和时间计算
 * - 播放结束和错误处理
 */

import { useState, useRef, useCallback, useEffect } from 'react';

export interface AudioPlayerConfig {
  autoPlay?: boolean;
  volume?: number;
  playbackRate?: number;
  loop?: boolean;
}

export interface AudioPlayerState {
  isPlaying: boolean;
  isLoading: boolean;
  isError: boolean;
  duration: number;
  currentTime: number;
  playProgress: number;        // 0-1的播放进度
  volume: number;
  playbackRate: number;
  buffered: TimeRanges | null;
  error: string | null;
}

export interface UseAudioPlayerReturn {
  state: AudioPlayerState;
  play: () => void;
  pause: () => void;
  playPause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  seekToProgress: (progress: number) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  load: (src: string) => void;
  audioRef: React.RefObject<HTMLAudioElement>;
}

const DEFAULT_CONFIG: Required<AudioPlayerConfig> = {
  autoPlay: false,
  volume: 1,
  playbackRate: 1,
  loop: false,
};

/**
 * 音频播放Hook
 * 
 * @param config 播放器配置
 * @returns 播放器状态和控制函数
 */
export function useAudioPlayer(config: AudioPlayerConfig = {}): UseAudioPlayerReturn {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  const audioRef = useRef(null);
  const isUserInteractionRef = useRef(false);
  const updateProgressRef = useRef(null);

  // 播放状态
  const [state, setState] = useState({
    isPlaying: false,
    isLoading: false,
    isError: false,
    duration: 0,
    currentTime: 0,
    playProgress: 0,
    volume: finalConfig.volume,
    playbackRate: finalConfig.playbackRate,
    buffered: null,
    error: null,
  });

  // 更新进度
  const updateProgress = useCallback(() => {
    if (!audioRef.current) return;

    const audio = audioRef.current;
    const currentTime = audio.currentTime;
    const duration = audio.duration || 0;
    const playProgress = duration > 0 ? currentTime / duration : 0;
    const buffered = audio.buffered;

    setState((prev: AudioPlayerState) => ({
      ...prev,
      currentTime,
      duration,
      playProgress,
      buffered,
    }));
  }, []);

  // 启动进度更新
  const startProgressUpdate = useCallback(() => {
    if (updateProgressRef.current) {
      clearInterval(updateProgressRef.current);
    }
    updateProgressRef.current = setInterval(updateProgress, 100); // 每100ms更新一次
  }, [updateProgress]);

  // 停止进度更新
  const stopProgressUpdate = useCallback(() => {
    if (updateProgressRef.current) {
      clearInterval(updateProgressRef.current);
      updateProgressRef.current = null;
    }
  }, []);

  // 初始化音频元素
  const initializeAudio = useCallback(() => {
    if (!audioRef.current) return;

    const audio = audioRef.current;
    
    // 设置初始属性
    audio.volume = finalConfig.volume;
    audio.playbackRate = finalConfig.playbackRate;
    audio.loop = finalConfig.loop;
    audio.preload = 'metadata';

    // 事件处理器
    const handleLoadStart = () => {
      setState((prev: AudioPlayerState) => ({ 
        ...prev, 
        isLoading: true, 
        isError: false, 
        error: null 
      }));
    };

    const handleLoadedData = () => {
      updateProgress();
      setState((prev: AudioPlayerState) => ({ 
        ...prev, 
        isLoading: false 
      }));
    };

    const handleCanPlay = () => {
      setState((prev: AudioPlayerState) => ({ 
        ...prev, 
        isLoading: false 
      }));
      
      // 自动播放
      if (finalConfig.autoPlay && !state.isPlaying && isUserInteractionRef.current) {
        audio.play().catch(console.error);
      }
    };

    const handlePlay = () => {
      setState((prev: AudioPlayerState) => ({ 
        ...prev, 
        isPlaying: true, 
        isError: false 
      }));
      startProgressUpdate();
    };

    const handlePause = () => {
      setState((prev: AudioPlayerState) => ({ 
        ...prev, 
        isPlaying: false 
      }));
      stopProgressUpdate();
    };

    const handleEnded = () => {
      setState((prev: AudioPlayerState) => ({ 
        ...prev, 
        isPlaying: false,
        currentTime: 0,
        playProgress: 0,
      }));
      stopProgressUpdate();
    };

    const handleError = (e: Event) => {
      const error = (e.target as HTMLAudioElement)?.error;
      let errorMessage = '音频播放出错';
      
      if (error) {
        switch (error.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            errorMessage = '音频播放被中止';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            errorMessage = '网络错误，无法播放音频';
            break;
          case MediaError.MEDIA_ERR_DECODE:
            errorMessage = '音频解码失败';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMessage = '不支持的音频格式';
            break;
          default:
            errorMessage = '未知播放错误';
        }
      }

      setState((prev: AudioPlayerState) => ({
        ...prev,
        isPlaying: false,
        isLoading: false,
        isError: true,
        error: errorMessage,
      }));
      stopProgressUpdate();
    };

    const handleTimeUpdate = () => {
      updateProgress();
    };

    const handleVolumeChange = () => {
      setState((prev: AudioPlayerState) => ({
        ...prev,
        volume: audio.volume,
      }));
    };

    const handleRateChange = () => {
      setState((prev: AudioPlayerState) => ({
        ...prev,
        playbackRate: audio.playbackRate,
      }));
    };

    // 绑定事件
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('loadeddata', handleLoadedData);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('volumechange', handleVolumeChange);
    audio.addEventListener('ratechange', handleRateChange);

    // 返回清理函数
    return () => {
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('loadeddata', handleLoadedData);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('volumechange', handleVolumeChange);
      audio.removeEventListener('ratechange', handleRateChange);
    };
  }, [finalConfig, startProgressUpdate, stopProgressUpdate, updateProgress, state.isPlaying]);

  // 播放
  const play = useCallback(async () => {
    if (!audioRef.current) return;

    try {
      isUserInteractionRef.current = true;
      await audioRef.current.play();
    } catch (error) {
      console.error('播放失败:', error);
      setState((prev: AudioPlayerState) => ({
        ...prev,
        isError: true,
        error: '播放失败，请重试',
      }));
    }
  }, []);

  // 暂停
  const pause = useCallback(() => {
    if (!audioRef.current) return;
    
    audioRef.current.pause();
  }, []);

  // 播放/暂停切换
  const playPause = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  }, [state.isPlaying, play, pause]);

  // 停止
  const stop = useCallback(() => {
    if (!audioRef.current) return;

    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }, []);

  // 🎯 定位到指定时间 - 修复闭包陈旧问题
  const seek = useCallback((time: number) => {
    if (!audioRef.current) return;

    // 🔧 实时获取音频duration，避免闭包陈旧
    const currentDuration = audioRef.current.duration || 0;
    const clampedTime = Math.max(0, Math.min(time, currentDuration));
    audioRef.current.currentTime = clampedTime;
    updateProgress();
  }, [updateProgress]);

  // 🎯 定位到指定进度 - 彻底解决状态陈旧问题
  const seekToProgress = useCallback((progress: number) => {
    if (!audioRef.current) return;

    const clampedProgress = Math.max(0, Math.min(progress, 1));
    
    // 🔧 直接从音频元素获取最新duration，避免state延迟
    const currentDuration = audioRef.current.duration || 0;
    if (currentDuration === 0) {
      console.warn('[useAudioPlayer] 音频未加载完成，无法seek');
      return;
    }
    
    const targetTime = clampedProgress * currentDuration;
    audioRef.current.currentTime = targetTime;
    updateProgress();
  }, [updateProgress]);

  // 设置音量
  const setVolume = useCallback((volume: number) => {
    if (!audioRef.current) return;

    const clampedVolume = Math.max(0, Math.min(volume, 1));
    audioRef.current.volume = clampedVolume;
  }, []);

  // 设置播放速率
  const setPlaybackRate = useCallback((rate: number) => {
    if (!audioRef.current) return;

    const clampedRate = Math.max(0.25, Math.min(rate, 4));
    audioRef.current.playbackRate = clampedRate;
  }, []);

  // 加载音频
  const load = useCallback((src: string) => {
    if (!audioRef.current) return;

    audioRef.current.src = src;
    audioRef.current.load();
  }, []);

  // 初始化音频元素
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    const cleanup = initializeAudio();

    return () => {
      cleanup?.();
      stopProgressUpdate();
    };
  }, [initializeAudio, stopProgressUpdate]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stopProgressUpdate();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, [stopProgressUpdate]);

  return {
    state,
    play,
    pause,
    playPause,
    stop,
    seek,
    seekToProgress,
    setVolume,
    setPlaybackRate,
    load,
    audioRef,
  };
}

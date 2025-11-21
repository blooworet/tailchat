/**
 * 简洁的录音 Hook
 * 基于 Telegram TT 架构设计
 * 
 * 核心原则：
 * - 只管理必要的 UI 状态
 * - 录音逻辑委托给 voiceRecording 工具
 * - 简单的状态管理，无复杂备用机制
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import * as voiceRecording from '../utils/voiceRecording';
import type { VoiceRecordingResult } from '../utils/voiceRecording';

type ActiveVoiceRecording = {
  stop: () => Promise<VoiceRecordingResult>;
  pause: () => void;
} | undefined;

export interface UseVoiceRecordingReturn {
  // 状态
  isRecording: boolean;
  currentRecordTime: number | undefined;
  waveform: number[];
  recordButtonRef: React.RefObject<HTMLButtonElement>;
  
  // 操作
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<VoiceRecordingResult | undefined>;
  pauseRecording: () => void;
}

export function useVoiceRecording(): UseVoiceRecordingReturn {
  const recordButtonRef = useRef(null as HTMLButtonElement | null);
  
  const [activeVoiceRecording, setActiveVoiceRecording] = useState(undefined as ActiveVoiceRecording);
  const [currentRecordTime, setCurrentRecordTime] = useState(undefined as number | undefined);
  const [waveform, setWaveform] = useState([] as number[]);
  const startRecordTimeRef = useRef(undefined as number | undefined);

  const startRecording = useCallback(async () => {
    try {
      const finalizeUI = () => {
        // 被动结束（例如 60s 超时）时，清理 UI 与状态
        setActiveVoiceRecording(undefined);
        startRecordTimeRef.current = undefined;
        setCurrentRecordTime(undefined);
        if (recordButtonRef.current) {
          recordButtonRef.current.style.boxShadow = 'none';
        }
      };

      const { stop, pause } = await voiceRecording.start((volume: number, currentWaveform: number[]) => {
        // 音量可视化效果
        if (recordButtonRef.current && startRecordTimeRef.current) {
          // 每4帧更新一次，避免频繁DOM操作
          if (Date.now() % 4 === 0) {
            const shadowSize = volume * 50;
            recordButtonRef.current.style.boxShadow = 
              `0 0 0 ${shadowSize}px rgba(59, 130, 246, 0.15)`; // 蓝色阴影
          }
          setCurrentRecordTime(Date.now());
        }
        
        // 更新实时波形数据（但不要太频繁）
        if (currentWaveform.length % 5 === 0) { // 每5个点更新一次
          setWaveform(currentWaveform);
        }
      }, finalizeUI);

      startRecordTimeRef.current = Date.now();
      setCurrentRecordTime(Date.now());
      setActiveVoiceRecording({ stop, pause });
    } catch (error) {
      console.error('录音启动失败:', error);
      // 学习 Telegram TT：重新抛出错误，让上层组件处理权限请求
      throw error;
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<VoiceRecordingResult | undefined> => {
    if (!activeVoiceRecording) {
      return undefined;
    }

    // 清理状态
    setActiveVoiceRecording(undefined);
    startRecordTimeRef.current = undefined;
    setCurrentRecordTime(undefined);

    // 清理UI效果
    if (recordButtonRef.current) {
      recordButtonRef.current.style.boxShadow = 'none';
    }

    try {
      return await activeVoiceRecording.stop();
    } catch (error) {
      console.error('录音停止失败:', error);
      return undefined;
    }
  }, [activeVoiceRecording]);

  const pauseRecording = useCallback(() => {
    if (!activeVoiceRecording) {
      return;
    }

    // 清理UI效果
    if (recordButtonRef.current) {
      recordButtonRef.current.style.boxShadow = 'none';
    }

    try {
      activeVoiceRecording.pause();
    } catch (error) {
      console.error('录音暂停失败:', error);
    }
  }, [activeVoiceRecording]);

  // ESC键取消录制
  useEffect(() => {
    if (!activeVoiceRecording) {
      return undefined;
    }

    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        stopRecording();
      }
    };

    document.addEventListener('keydown', handleEscKey);
    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [activeVoiceRecording, stopRecording]);

  return {
    isRecording: !!activeVoiceRecording,
    currentRecordTime,
    waveform,
    recordButtonRef,
    startRecording,
    stopRecording,
    pauseRecording,
  };
}

/**
 * 简洁的录音工具
 * 基于 Telegram TT 架构设计
 * 
 * 核心原则：
 * - 独立于 React，纯粹的录音 API
 * - 全局单例，避免多实例问题
 * - 简单的 Promise 链，无复杂状态管理
 * - 完善的权限检查和错误处理
 */

// 🚀 移除预检查导入，学习 Telegram TT 的简洁方法
// import { testMicrophoneAccess, type MicrophoneTestResult } from './microphonePermission';

export interface VoiceRecordingResult {
  blob: Blob;
  duration: number;
  waveform: number[];
}

const MIN_RECORDING_TIME = 1000; // 最小录制时间 1秒
const MAX_RECORDING_TIME = 60000; // 最大录制时间 60秒
const FFT_SIZE = 64;
const MIN_VOLUME = 0.1;
const BLOB_PARAMS = { type: 'audio/webm;codecs=opus' };

let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;

/**
 * 开始录音
 * @param analyzerCallback 音量分析回调
 * @returns 包含 stop 和 pause 方法的对象
 */
export async function start(
  analyzerCallback: (volume: number, currentWaveform: number[]) => void,
  onFinalize?: () => void
) {
  // 🚀 学习 Telegram TT：直接获取麦克风权限，让浏览器弹出权限对话框
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
    }
  });

  // 创建 MediaRecorder
  let mimeType = 'audio/webm;codecs=opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/wav';
      }
    }
  }

  mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
  
  const startedAt = Date.now();
  let pausedAt: number | null = null;
  const chunks: Blob[] = [];
  const waveform: number[] = [];

  // 数据收集
  mediaRecorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  // 音频分析 - 学习 Telegram TT 的实现
  const releaseAnalyzer = subscribeToAnalyzer(mediaStream, (volume: number) => {
    waveform.push(Math.floor(volume * 255)); // 🔧 使用 0-255 范围（Telegram TT 标准）
    analyzerCallback(volume, [...waveform]); // 🎵 传递实时波形数据副本
  });

  // 开始录制
  mediaRecorder.start(100); // 每100ms收集数据

  // 最大录制时间保护：到达上限时主动停止并释放麦克风资源
  const maxTimeTimeout = setTimeout(() => {
    try {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    } finally {
      // 无论是否成功停止，都释放分析器与媒体轨道，避免麦克风占用不释放
      try { releaseAnalyzer(); } catch {}
      try { cleanup(); } catch {}
      try { onFinalize && onFinalize(); } catch {}
    }
  }, MAX_RECORDING_TIME);

  return {
    stop: (): Promise<VoiceRecordingResult> => new Promise((resolve, reject) => {
      if (!mediaRecorder) {
        reject(new Error('MediaRecorder is not available'));
        return;
      }

      mediaRecorder.onstop = () => {
        try {
          const actualDuration = Math.round(((pausedAt || Date.now()) - startedAt) / 1000);
          
          resolve({
            blob: new Blob(chunks, { type: mimeType }),
            duration: actualDuration,
            waveform: [...waveform],
          });
        } catch (error) {
          reject(error);
        } finally {
          cleanup();
        }
      };

      mediaRecorder.onerror = (error) => {
        reject(error);
        cleanup();
      };

      // 确保最小录制时间
      const delayStop = Math.max(0, startedAt + MIN_RECORDING_TIME - Date.now());
      setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
        releaseAnalyzer();
        clearTimeout(maxTimeTimeout);
      }, delayStop);
    }),

    pause: () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        const delayPause = Math.max(0, startedAt + MIN_RECORDING_TIME - Date.now());
        setTimeout(() => {
          if (mediaRecorder) {
            mediaRecorder.pause();
            pausedAt = Date.now();
          }
          releaseAnalyzer();
          clearTimeout(maxTimeTimeout);
        }, delayPause);
      }
    },
  };
}

/**
 * 音频分析器
 */
function subscribeToAnalyzer(stream: MediaStream, callback: (volume: number) => void) {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  
  analyser.fftSize = FFT_SIZE;
  source.connect(analyser);

  const dataLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(dataLength);
  let isDestroyed = false;

  function tick() {
    if (isDestroyed) {
      return;
    }

    analyser.getByteFrequencyData(dataArray);

    const sum = dataArray.reduce((acc, current) => acc + current, 0);
    const mean = sum / dataLength;
    const volume = mean / 255;

    callback(volume < MIN_VOLUME ? 0 : volume);

    // 使用 requestAnimationFrame 而不是自定义的 requestMeasure
    requestAnimationFrame(tick);
  }

  tick();

  return () => {
    isDestroyed = true;
    try {
      source.disconnect();
      audioContext.close();
    } catch (error) {
      // 静默处理清理错误
    }
  };
}

/**
 * 清理资源
 */
function cleanup() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }
  mediaRecorder = null;
}

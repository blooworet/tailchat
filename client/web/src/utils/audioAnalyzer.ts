/**
 * Web Audio API音频分析器
 * 基于Telegram TT的实现 (telegram-tt/src/util/voiceRecording.ts)
 * 
 * 核心功能：
 * - Web Audio API封装
 * - 实时音频能量分析
 * - FFT频谱数据处理
 */

export interface AudioAnalyzerConfig {
  fftSize?: number;        // FFT大小，默认64（与Telegram一致）
  minVolume?: number;      // 最小音量阈值，默认0.1
  sampleInterval?: number; // 采样间隔（毫秒），默认50ms
}

export interface VolumeCallback {
  (volume: number): void;
}

export interface AudioAnalyzerResult {
  destroy: () => void;
  getVolume: () => number;
  getCurrentFrequencyData: () => Uint8Array;
}

/**
 * Web Audio API音频分析器类
 * 用于实时分析音频流的音量和频率数据
 */
export class AudioAnalyzer {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private isDestroyed = false;
  private animationFrameId: number | null = null;
  
  private readonly config: Required<AudioAnalyzerConfig>;
  private volumeCallbacks: VolumeCallback[] = [];
  private currentVolume = 0;

  constructor(config: AudioAnalyzerConfig = {}) {
    this.config = {
      fftSize: 64,           // 与Telegram TT保持一致
      minVolume: 0.1,        // 最小音量阈值
      sampleInterval: 50,    // 50ms采样间隔（20fps）
      ...config
    };
  }

  /**
   * 初始化音频分析器
   * 
   * @param mediaStream 媒体流
   * @returns Promise<void>
   */
  async initialize(mediaStream: MediaStream): Promise<void> {
    try {
      // 创建AudioContext
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // 创建源节点
      this.sourceNode = this.audioContext.createMediaStreamSource(mediaStream);
      
      // 创建分析节点
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = this.config.fftSize;
      this.analyserNode.smoothingTimeConstant = 0.8; // 平滑常数
      
      // 连接节点
      this.sourceNode.connect(this.analyserNode);
      
      // 初始化数据数组
      const bufferLength = this.analyserNode.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
      
      // 开始分析循环
      this.startAnalysis();
      
    } catch (error) {
      console.error('AudioAnalyzer initialization failed:', error);
      throw new Error(`音频分析器初始化失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 订阅音量变化回调
   * 
   * @param callback 音量变化回调函数
   * @returns 取消订阅的函数
   */
  subscribeToVolume(callback: VolumeCallback): () => void {
    this.volumeCallbacks.push(callback);
    
    return () => {
      const index = this.volumeCallbacks.indexOf(callback);
      if (index > -1) {
        this.volumeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * 获取当前音量值
   * 
   * @returns number 0-1范围的音量值
   */
  getVolume(): number {
    return this.currentVolume;
  }

  /**
   * 获取当前频率数据
   * 
   * @returns Uint8Array 频率数据数组
   */
  getCurrentFrequencyData(): Uint8Array {
    if (!this.analyserNode || !this.dataArray) {
      return new Uint8Array(0);
    }
    
    this.analyserNode.getByteFrequencyData(this.dataArray);
    return this.dataArray.slice();
  }

  /**
   * 获取当前时域数据（波形数据）
   * 
   * @returns Uint8Array 时域数据数组
   */
  getCurrentTimeDomainData(): Uint8Array {
    if (!this.analyserNode || !this.dataArray) {
      return new Uint8Array(0);
    }
    
    this.analyserNode.getByteTimeDomainData(this.dataArray);
    return this.dataArray.slice();
  }

  /**
   * 计算音频RMS能量
   * 
   * @param frequencyData 频率数据数组
   * @returns number RMS能量值
   */
  private calculateRMSEnergy(frequencyData: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < frequencyData.length; i++) {
      sum += frequencyData[i] * frequencyData[i];
    }
    return Math.sqrt(sum / frequencyData.length) / 255;
  }

  /**
   * 计算音频平均能量
   * 基于Telegram TT的实现
   * 
   * @param frequencyData 频率数据数组
   * @returns number 0-1范围的音量值
   */
  private calculateAverageVolume(frequencyData: Uint8Array): number {
    const sum = frequencyData.reduce((acc, current) => acc + current, 0);
    const mean = sum / frequencyData.length;
    const volume = mean / 255;
    
    // 应用最小音量阈值
    return volume < this.config.minVolume ? 0 : volume;
  }

  /**
   * 开始音频分析循环
   */
  private startAnalysis(): void {
    let callbackCount = 0;
    
    const tick = () => {
      if (this.isDestroyed || !this.analyserNode || !this.dataArray) {
        return;
      }

      // 获取频率数据
      this.analyserNode.getByteFrequencyData(this.dataArray);
      
      // 计算音量
      this.currentVolume = this.calculateAverageVolume(this.dataArray);
      
      callbackCount++;
      
      // 通知所有订阅者
      this.volumeCallbacks.forEach(callback => {
        try {
          callback(this.currentVolume);
        } catch (error) {
          console.error('Volume callback error:', error);
        }
      });

      // 使用setTimeout来控制采样间隔，而不是requestAnimationFrame
      setTimeout(() => {
        this.animationFrameId = requestAnimationFrame(tick);
      }, this.config.sampleInterval);
    };

    tick();
  }

  /**
   * 销毁音频分析器
   */
  destroy(): void {
    this.isDestroyed = true;
    
    // 取消动画帧
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    // 清理音频节点
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch (error) {
        console.warn('Error disconnecting source node:', error);
      }
      this.sourceNode = null;
    }
    
    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch (error) {
        console.warn('Error disconnecting analyser node:', error);
      }
      this.analyserNode = null;
    }
    
    // 关闭AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (error) {
        console.warn('Error closing audio context:', error);
      }
      this.audioContext = null;
    }
    
    // 清理回调
    this.volumeCallbacks = [];
    this.dataArray = null;
  }
}

/**
 * 创建音频分析器的便捷函数
 * 
 * @param mediaStream 媒体流
 * @param config 配置选项
 * @returns Promise<AudioAnalyzerResult>
 */
export async function createAudioAnalyzer(
  mediaStream: MediaStream, 
  config?: AudioAnalyzerConfig
): Promise<AudioAnalyzerResult> {
  const analyzer = new AudioAnalyzer(config);
  await analyzer.initialize(mediaStream);
  
  return {
    destroy: () => analyzer.destroy(),
    getVolume: () => analyzer.getVolume(),
    getCurrentFrequencyData: () => analyzer.getCurrentFrequencyData()
  };
}

/**
 * 检查浏览器是否支持Web Audio API
 * 
 * @returns boolean 是否支持
 */
export function isWebAudioSupported(): boolean {
  return !!(window.AudioContext || (window as any).webkitAudioContext);
}

/**
 * 获取音频上下文状态
 * 
 * @param audioContext 音频上下文
 * @returns string 状态字符串
 */
export function getAudioContextState(audioContext: AudioContext): string {
  return audioContext.state;
}

/**
 * 恢复音频上下文（处理浏览器自动播放策略）
 * 
 * @param audioContext 音频上下文
 * @returns Promise<void>
 */
export async function resumeAudioContext(audioContext: AudioContext): Promise<void> {
  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume();
    } catch (error) {
      console.error('Failed to resume audio context:', error);
      throw new Error('无法恢复音频上下文');
    }
  }
}

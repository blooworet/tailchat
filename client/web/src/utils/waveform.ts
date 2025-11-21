/**
 * 音频波形数据处理工具
 * 基于Telegram TT的成熟实现 (telegram-tt/src/util/waveform.ts)
 * 
 * 核心功能：
 * - 5bit编码波形数据解码（兼容Telegram格式）
 * - 波形数据插值和平滑算法
 * - AudioBuffer到波形数据转换
 */

export interface WaveformData {
  spikes: number[];     // 0-31的振幅数组
  peak: number;         // 最大振幅值
  duration: number;     // 音频时长
}

/**
 * 解码Telegram格式的5bit编码波形数据
 * 参考: https://github.com/telegramdesktop/tdesktop/blob/master/Telegram/SourceFiles/data/data_document.cpp#L1018
 * 
 * @param encoded5bit 5bit编码的Uint8Array数据
 * @returns 解码后的0-31范围数值数组
 */
export function decodeWaveform(encoded5bit: Uint8Array): number[] {
  const bitsCount = encoded5bit.length * 8;
  const valuesCount = Math.floor(bitsCount / 5);
  
  if (!valuesCount) {
    return [];
  }

  // 读取每个5bit作为0-31的无符号字符
  // 我们计算所需5bit序列开始的字节索引
  // 然后从该字节开始读取uint16以保证获取所有5bit
  //
  // 但是！如果是最后一个字节，我们不能从它开始读取uint16
  // 因为这会造成溢出（访问可用内存之后的一个字节）
  // 我们看到只有最后5bit可能在最后可用字节中开始并造成问题
  // 所以我们以通用方式读取除最后一个条目外的所有条目
  const result = Array(valuesCount);
  const bitsData = encoded5bit;
  
  for (let i = 0, l = valuesCount - 1; i !== l; ++i) {
    const byteIndex = Math.floor((i * 5) / 8);
    const bitShift = Math.floor((i * 5) % 8);
    const value = bitsData[byteIndex] + (bitsData[byteIndex + 1] << 8);
    result[i] = ((value >> bitShift) & 0x1F);
  }
  
  // 处理最后一个值
  const lastByteIndex = Math.floor(((valuesCount - 1) * 5) / 8);
  const lastBitShift = Math.floor(((valuesCount - 1) * 5) % 8);
  const lastValue = bitsData[lastByteIndex] + (bitsData[lastByteIndex + 1] << 8);
  result[valuesCount - 1] = (lastValue >> lastBitShift) & 0x1F;

  return result;
}

/**
 * 波形数据插值处理
 * 将原始数据调整到目标数量，同时保持波形特征
 * 
 * @param data 原始波形数据数组
 * @param fitCount 目标数据点数量
 * @returns 插值后的数据和峰值
 */
export function interpolateArray(data: number[], fitCount: number): { data: number[], peak: number } {
  let peak = 0;
  const newData = new Array(fitCount);
  const springFactor = data.length / fitCount;
  const leftFiller = data[0] || 0;
  const rightFiller = data[data.length - 1] || 0;
  
  for (let i = 0; i < fitCount; i++) {
    const idx = Math.floor(i * springFactor);
    // 使用三点平均进行平滑处理
    const val = ((data[idx - 1] ?? leftFiller) + (data[idx] ?? leftFiller) + (data[idx + 1] ?? rightFiller)) / 3;
    newData[i] = val;
    
    if (peak < val) {
      peak = val;
    }
  }
  
  return { data: newData, peak };
}

/**
 * 从AudioBuffer生成波形数据
 * 分析音频数据并生成0-31范围的波形数组
 * 
 * @param audioBuffer Web Audio API的AudioBuffer
 * @param targetLength 目标波形数据长度
 * @returns Promise<WaveformData>
 */
export async function generateWaveformFromAudioBuffer(
  audioBuffer: AudioBuffer, 
  targetLength: number = 64
): Promise<WaveformData> {
  const channelData = audioBuffer.getChannelData(0); // 使用第一个声道
  const samples = channelData.length;
  const samplesPerSegment = Math.floor(samples / targetLength);
  const waveform: number[] = [];
  
  let peak = 0;
  
  for (let i = 0; i < targetLength; i++) {
    const start = i * samplesPerSegment;
    const end = Math.min(start + samplesPerSegment, samples);
    
    // 计算该段的RMS（均方根）能量
    let sum = 0;
    let count = 0;
    
    for (let j = start; j < end; j++) {
      const sample = Math.abs(channelData[j]);
      sum += sample * sample;
      count++;
    }
    
    const rms = count > 0 ? Math.sqrt(sum / count) : 0;
    // 映射到0-31范围
    const amplitude = Math.floor(rms * 31);
    waveform.push(amplitude);
    
    if (amplitude > peak) {
      peak = amplitude;
    }
  }
  
  return {
    spikes: waveform,
    peak,
    duration: audioBuffer.duration
  };
}

/**
 * 创建空白波形数据（用于占位显示）
 * 
 * @param length 波形数据长度
 * @param duration 音频时长
 * @returns WaveformData
 */
export function createEmptyWaveform(length: number, duration: number): WaveformData {
  return {
    spikes: new Array(Math.min(length, 30)).fill(0), // 最大30个点
    peak: 0,
    duration
  };
}

/**
 * 编码波形数据为5bit格式（用于数据存储）
 * 
 * @param waveform 0-31范围的波形数据
 * @returns Uint8Array 编码后的数据
 */
export function encodeWaveform(waveform: number[]): Uint8Array {
  const valuesCount = waveform.length;
  const bitsCount = valuesCount * 5;
  const bytesCount = Math.ceil(bitsCount / 8);
  const result = new Uint8Array(bytesCount);
  
  for (let i = 0; i < valuesCount; i++) {
    const value = Math.max(0, Math.min(31, waveform[i])); // 确保在0-31范围
    const bitOffset = i * 5;
    const byteIndex = Math.floor(bitOffset / 8);
    const bitShift = bitOffset % 8;
    
    if (byteIndex < bytesCount) {
      result[byteIndex] |= (value << bitShift);
      
      // 如果值跨越字节边界
      if (bitShift > 3 && byteIndex + 1 < bytesCount) {
        result[byteIndex + 1] |= (value >> (8 - bitShift));
      }
    }
  }
  
  return result;
}

/**
 * 验证波形数据有效性
 * 
 * @param waveform 波形数据数组
 * @returns boolean 是否有效
 */
export function isValidWaveform(waveform: number[]): boolean {
  if (!Array.isArray(waveform) || waveform.length === 0) {
    return false;
  }
  
  // 检查所有值是否在0-31范围内
  return waveform.every(value => 
    typeof value === 'number' && 
    value >= 0 && 
    value <= 31 && 
    Number.isInteger(value)
  );
}

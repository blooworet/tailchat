import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Alert,
} from 'react-native';
import { Colors } from 'react-native-ui-lib';

// 注意: 此组件需要安装以下依赖:
// npm install react-native-audio-recorder-player
// 对于iOS还需要: cd ios && pod install

// 类型定义 (在实际项目中，这些可能来自已安装的库)
interface AudioRecorderPlayerType {
  startPlayer(path: string): Promise<string>;
  stopPlayer(): Promise<string>;
  pausePlayer(): Promise<string>;
  resumePlayer(): Promise<string>;
  seekToPlayer(time: number): Promise<string>;
  addPlayBackListener(callback: (data: any) => void): void;
  removePlayBackListener(): void;
  setVolume(volume: number): Promise<string>;
}

interface PlaybackInfo {
  currentPosition: number;
  duration: number;
}

interface AudioPlayerProps {
  audioUrl: string;
  duration?: number; // 音频时长（秒）
  waveform?: number[]; // 声纹数据（0-31范围）
  style?: any;
  isIncoming?: boolean; // 是否是接收的消息
}

const screenWidth = Dimensions.get('window').width;
const maxPlayerWidth = screenWidth * 0.7;

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  audioUrl,
  duration = 0,
  waveform = [],
  style,
  isIncoming = true,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [processedWaveform, setProcessedWaveform] = useState<number[]>([]);

  // 注意: 在实际项目中需要导入和实例化AudioRecorderPlayer
  // import AudioRecorderPlayer from 'react-native-audio-recorder-player';
  // const audioPlayerRef = useRef(new AudioRecorderPlayer());
  const audioPlayerRef = useRef<AudioRecorderPlayerType | null>(null);
  const playbackListenerRef = useRef<any>(null);

  // 初始化播放器（实际项目中的实现）
  const initializePlayer = useCallback(async () => {
    try {
      // 在实际项目中，这里会创建AudioRecorderPlayer实例
      // const player = new AudioRecorderPlayer();
      // audioPlayerRef.current = player;
      
      // 模拟初始化
      console.log('AudioPlayer initialized (需要安装 react-native-audio-recorder-player)');
    } catch (error) {
      console.error('初始化播放器失败:', error);
      setHasError(true);
    }
  }, []);

  // 处理声纹数据
  useEffect(() => {
    if (waveform && waveform.length > 0) {
      // 将声纹数据限制在合适的长度（移动端显示）
      const maxBars = Math.floor((maxPlayerWidth - 80) / 4); // 每个条形4px宽度
      const targetLength = Math.min(maxBars, Math.max(20, duration * 2)); // 基于时长动态调整
      
      if (waveform.length === targetLength) {
        setProcessedWaveform(waveform);
      } else if (waveform.length > targetLength) {
        // 数据太多，进行采样
        const step = waveform.length / targetLength;
        const sampled = [];
        for (let i = 0; i < targetLength; i++) {
          const index = Math.floor(i * step);
          sampled.push(waveform[index] || 0);
        }
        setProcessedWaveform(sampled);
      } else {
        // 数据不足，进行插值
        const interpolated = [];
        const ratio = (waveform.length - 1) / (targetLength - 1);
        for (let i = 0; i < targetLength; i++) {
          const index = i * ratio;
          const lower = Math.floor(index);
          const upper = Math.ceil(index);
          const weight = index - lower;
          
          if (lower === upper) {
            interpolated.push(waveform[lower] || 0);
          } else {
            const lowerValue = waveform[lower] || 0;
            const upperValue = waveform[upper] || 0;
            interpolated.push(Math.round(lowerValue * (1 - weight) + upperValue * weight));
          }
        }
        setProcessedWaveform(interpolated);
      }
    } else {
      // 生成默认波形数据
      const defaultLength = Math.max(20, Math.min(60, duration * 2));
      const defaultWaveform = Array.from({ length: defaultLength }, () => Math.floor(Math.random() * 8) + 2);
      setProcessedWaveform(defaultWaveform);
    }
  }, [waveform, duration]);

  // 组件挂载时初始化
  useEffect(() => {
    initializePlayer();
    
    return () => {
      // 清理资源
      stopPlayback();
    };
  }, [initializePlayer]);

  // 开始播放
  const startPlayback = useCallback(async () => {
    try {
      setIsLoading(true);
      setHasError(false);

      // 初始化播放器
      if (!audioPlayerRef.current) {
        await initializePlayer();
      }

      const player = audioPlayerRef.current;
      if (!player) {
        throw new Error('播放器初始化失败');
      }

      // 实际项目中的播放开始逻辑
      // await player.startPlayer(audioUrl);
      // player.setVolume(1.0);
      
      console.log('开始播放音频:', audioUrl);
      setIsPlaying(true);

      // 添加播放进度监听
      // playbackListenerRef.current = player.addPlayBackListener((data: PlaybackInfo) => {
      //   const currentTimeSeconds = Math.floor(data.currentPosition / 1000);
      //   const durationSeconds = Math.floor(data.duration / 1000);
      //   
      //   setCurrentTime(currentTimeSeconds);
      //   if (durationSeconds > 0 && totalDuration === 0) {
      //     setTotalDuration(durationSeconds);
      //   }
      //   
      //   // 播放结束
      //   if (data.currentPosition >= data.duration) {
      //     setIsPlaying(false);
      //     setCurrentTime(0);
      //   }
      // });

      // 模拟播放进度
      const simulatePlayback = () => {
        const interval = setInterval(() => {
          setCurrentTime(prev => {
            const newTime = prev + 1;
            if (newTime >= (totalDuration || duration)) {
              setIsPlaying(false);
              clearInterval(interval);
              return 0;
            }
            return newTime;
          });
        }, 1000);
        
        return interval;
      };

      simulatePlayback();
    } catch (error) {
      console.error('播放音频失败:', error);
      setHasError(true);
      Alert.alert('播放失败', '无法播放该语音消息，请重试');
    } finally {
      setIsLoading(false);
    }
  }, [audioUrl, initializePlayer, totalDuration, duration]);

  // 暂停播放
  const pausePlayback = useCallback(async () => {
    try {
      const player = audioPlayerRef.current;
      if (player && isPlaying) {
        // await player.pausePlayer();
        console.log('暂停播放');
        setIsPlaying(false);
      }
    } catch (error) {
      console.error('暂停播放失败:', error);
    }
  }, [isPlaying]);

  // 恢复播放
  const resumePlayback = useCallback(async () => {
    try {
      const player = audioPlayerRef.current;
      if (player && !isPlaying) {
        // await player.resumePlayer();
        console.log('恢复播放');
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('恢复播放失败:', error);
    }
  }, [isPlaying]);

  // 停止播放
  const stopPlayback = useCallback(async () => {
    try {
      const player = audioPlayerRef.current;
      if (player) {
        // await player.stopPlayer();
        // player.removePlayBackListener();
        console.log('停止播放');
      }
      
      setIsPlaying(false);
      setCurrentTime(0);
      playbackListenerRef.current = null;
    } catch (error) {
      console.error('停止播放失败:', error);
    }
  }, []);

  // 播放/暂停切换
  const togglePlayback = useCallback(async () => {
    if (hasError) {
      // 重试播放
      setHasError(false);
      await startPlayback();
      return;
    }

    if (isPlaying) {
      await pausePlayback();
    } else if (currentTime > 0) {
      await resumePlayback();
    } else {
      await startPlayback();
    }
  }, [isPlaying, currentTime, hasError, startPlayback, pausePlayback, resumePlayback]);

  // 进度条点击跳转
  const seekToPosition = useCallback(async (position: number) => {
    try {
      const player = audioPlayerRef.current;
      if (player && (totalDuration || duration) > 0) {
        const seekTime = position * (totalDuration || duration) * 1000; // 转换为毫秒
        // await player.seekToPlayer(seekTime);
        
        const newTime = Math.floor(position * (totalDuration || duration));
        setCurrentTime(newTime);
        console.log('跳转到:', newTime, '秒');
      }
    } catch (error) {
      console.error('跳转播放位置失败:', error);
    }
  }, [totalDuration, duration]);

  // 格式化时间显示
  const formatTime = (timeSeconds: number) => {
    if (!isFinite(timeSeconds) || isNaN(timeSeconds)) return '0:00';
    
    const minutes = Math.floor(timeSeconds / 60);
    const seconds = timeSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // 计算进度百分比
  const progressPercentage = (totalDuration || duration) > 0 
    ? (currentTime / (totalDuration || duration)) * 100 
    : 0;

  // 处理进度条点击
  const handleProgressBarPress = useCallback((event: any) => {
    const { locationX } = event.nativeEvent;
    const progressBarWidth = maxPlayerWidth - 120; // 减去按钮和时间显示的宽度
    const position = locationX / progressBarWidth;
    
    if (position >= 0 && position <= 1) {
      seekToPosition(position);
    }
  }, [seekToPosition]);

  // 渲染声纹波形
  const renderWaveform = () => {
    if (!processedWaveform.length) {
      return null;
    }

    const progress = (totalDuration || duration) > 0 ? currentTime / (totalDuration || duration) : 0;
    const progressIndex = Math.floor(progress * processedWaveform.length);

    return (
      <View style={styles.waveformContainer}>
        {processedWaveform.map((amplitude, index) => {
          const isActive = index <= progressIndex;
          const height = Math.max(2, (amplitude / 31) * 24); // 映射到24px最大高度
          
          return (
            <View
              key={index}
              style={[
                styles.waveformBar,
                {
                  height,
                  backgroundColor: isActive 
                    ? (isIncoming ? Colors.white : 'rgba(255, 255, 255, 0.9)')
                    : 'rgba(255, 255, 255, 0.3)',
                }
              ]}
            />
          );
        })}
      </View>
    );
  };

  // 处理波形点击定位
  const handleWaveformPress = useCallback((event: any) => {
    const { locationX } = event.nativeEvent;
    const waveformWidth = maxPlayerWidth - 80; // 减去按钮宽度
    const position = locationX / waveformWidth;
    
    if (position >= 0 && position <= 1) {
      seekToPosition(position);
    }
  }, [seekToPosition]);

  // 错误状态显示
  if (hasError) {
    return (
      <View style={[styles.container, styles.errorContainer, style]}>
        <TouchableOpacity style={styles.retryButton} onPress={togglePlayback}>
          <Text style={styles.retryIcon}>⚠️</Text>
        </TouchableOpacity>
        <View style={styles.errorContent}>
          <Text style={styles.errorText}>语音加载失败</Text>
          <TouchableOpacity onPress={togglePlayback}>
            <Text style={styles.retryText}>点击重试</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[
      styles.container,
      isIncoming ? styles.incomingMessage : styles.outgoingMessage,
      style
    ]}>
      {/* 播放/暂停按钮 */}
      <TouchableOpacity
        style={styles.playButton}
        onPress={togglePlayback}
        disabled={isLoading}
      >
        <Text style={styles.playIcon}>
          {isLoading ? '⏳' : isPlaying ? '⏸️' : '▶️'}
        </Text>
      </TouchableOpacity>

      {/* 声纹和时间信息 */}
      <View style={styles.progressContainer}>
        {/* 声纹波形显示 */}
        {processedWaveform.length > 0 ? (
          <TouchableOpacity
            style={styles.waveformTouchArea}
            onPress={handleWaveformPress}
            activeOpacity={0.8}
          >
            {renderWaveform()}
          </TouchableOpacity>
        ) : (
          /* 降级到进度条 */
          <TouchableOpacity
            style={styles.progressBar}
            onPress={handleProgressBarPress}
            activeOpacity={0.8}
          >
            <View style={styles.progressBackground}>
              <View
                style={[
                  styles.progressForeground,
                  { width: `${Math.min(100, Math.max(0, progressPercentage))}%` }
                ]}
              />
            </View>
          </TouchableOpacity>
        )}

        {/* 时间显示 */}
        <View style={styles.timeContainer}>
          <Text style={styles.timeText}>
            {formatTime(currentTime)} / {formatTime(totalDuration || duration)}
          </Text>
          <Text style={styles.labelText}>语音消息</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    maxWidth: maxPlayerWidth,
    marginVertical: 4,
  },
  incomingMessage: {
    backgroundColor: Colors.grey70,
    alignSelf: 'flex-start',
  },
  outgoingMessage: {
    backgroundColor: Colors.blue30,
    alignSelf: 'flex-end',
  },
  errorContainer: {
    backgroundColor: Colors.red70,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  playIcon: {
    fontSize: 18,
  },
  retryButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  retryIcon: {
    fontSize: 18,
  },
  progressContainer: {
    flex: 1,
  },
  progressBar: {
    height: 20,
    marginBottom: 4,
  },
  progressBackground: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressForeground: {
    height: '100%',
    backgroundColor: Colors.white,
    borderRadius: 2,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 11,
    color: Colors.white,
    fontFamily: 'monospace',
  },
  labelText: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  errorContent: {
    flex: 1,
  },
  errorText: {
    fontSize: 12,
    color: Colors.white,
    marginBottom: 2,
  },
  retryText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.8)',
    textDecorationLine: 'underline',
  },
  // 声纹相关样式
  waveformTouchArea: {
    height: 32,
    marginBottom: 4,
    justifyContent: 'center',
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 24,
    gap: 1,
  },
  waveformBar: {
    width: 2,
    borderRadius: 1,
    minHeight: 2,
  },
});

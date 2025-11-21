import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Vibration,
  Platform,
} from 'react-native';
import { Colors } from 'react-native-ui-lib';
import { ensureAudioRecordPermission } from '../lib/permissions';

// 注意: 此组件需要安装以下依赖:
// npm install react-native-audio-recorder-player
// 对于iOS还需要: cd ios && pod install

// 类型定义 (在实际项目中，这些可能来自已安装的库)
interface AudioRecorderPlayerType {
  startRecorder(path?: string): Promise<string>;
  stopRecorder(): Promise<string>;
  addRecordBackListener(callback: (data: any) => void): void;
  removeRecordBackListener(): void;
}

interface RecordingInfo {
  currentPosition: number;
  currentMetering?: number;
}

interface AudioRecorderProps {
  onSendAudio: (audioUrl: string, duration: number, waveform?: number[]) => void;
  onRecordingStateChange?: (isRecording: boolean) => void;
  maxDuration?: number; // 最大录音时长(秒)
  minDuration?: number; // 最小录音时长(秒)
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({
  onSendAudio,
  onRecordingStateChange,
  maxDuration = 60,
  minDuration = 1,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [currentVolume, setCurrentVolume] = useState(0);

  // 注意: 在实际项目中需要导入和实例化AudioRecorderPlayer
  // import AudioRecorderPlayer from 'react-native-audio-recorder-player';
  // const audioRecorderPlayerRef = useRef(new AudioRecorderPlayer());
  const audioRecorderPlayerRef = useRef<AudioRecorderPlayerType | null>(null);
  const startTimeRef = useRef<number>(0);
  const recordPathRef = useRef<string>('');
  const waveformIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 初始化录音器（实际项目中的实现）
  const initializeRecorder = useCallback(async () => {
    try {
      // 在实际项目中，这里会创建AudioRecorderPlayer实例
      // const recorder = new AudioRecorderPlayer();
      // audioRecorderPlayerRef.current = recorder;
      
      // 模拟初始化
      console.log('AudioRecorder initialized (需要安装 react-native-audio-recorder-player)');
    } catch (error) {
      console.error('初始化录音器失败:', error);
    }
  }, []);

  // 检查权限
  const checkPermission = useCallback(async () => {
    try {
      const granted = await ensureAudioRecordPermission();
      setHasPermission(granted);
      
      if (!granted) {
        Alert.alert(
          '权限需求',
          '需要麦克风权限来录制语音消息。请在设置中允许麦克风权限。',
          [{ text: '确定' }]
        );
      }
      
      return granted;
    } catch (error) {
      console.error('检查权限失败:', error);
      setHasPermission(false);
      return false;
    }
  }, []);

  // 开始录音
  const startRecording = useCallback(async () => {
    try {
      // 检查权限
      const hasPermission = await checkPermission();
      if (!hasPermission) {
        return;
      }

      // 初始化录音器
      if (!audioRecorderPlayerRef.current) {
        await initializeRecorder();
      }

      const recorder = audioRecorderPlayerRef.current;
      if (!recorder) {
        Alert.alert('错误', '录音器初始化失败，请重试');
        return;
      }

      // 触觉反馈
      Vibration.vibrate(50);

      // 开始录音
      startTimeRef.current = Date.now();
      setRecordingTime(0);
      setIsRecording(true);
      onRecordingStateChange?.(true);

      // 实际项目中的录音开始逻辑
      // const audioPath = await recorder.startRecorder();
      // recordPathRef.current = audioPath;
      
      // 模拟录音路径
      recordPathRef.current = `audio_${Date.now()}.m4a`;
      console.log('录音开始:', recordPathRef.current);

      // 添加录音进度监听
      // recorder.addRecordBackListener((data: RecordingInfo) => {
      //   const currentTime = Math.floor(data.currentPosition / 1000);
      //   setRecordingTime(currentTime);
      //   
      //   // 检查最大录音时长
      //   if (currentTime >= maxDuration) {
      //     stopRecording();
      //   }
      // });

      // 模拟录音时间和声纹数据更新
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setRecordingTime(elapsed);
        
        // 模拟声纹数据生成 (基于Telegram TT算法)
        const volume = Math.floor(Math.random() * 32); // 0-31范围的5bit数据
        setCurrentVolume(volume);
        setWaveformData(prev => [...prev, volume]);
        
        if (elapsed >= maxDuration) {
          clearInterval(interval);
          stopRecording();
        }
      }, 50); // 每50ms采样一次，符合Telegram标准

      waveformIntervalRef.current = interval;

      return interval;
    } catch (error) {
      console.error('开始录音失败:', error);
      Alert.alert('错误', '录音启动失败，请重试');
      setIsRecording(false);
      onRecordingStateChange?.(false);
    }
  }, [checkPermission, initializeRecorder, maxDuration, onRecordingStateChange]);

  // 停止录音
  const stopRecording = useCallback(async () => {
    try {
      const recorder = audioRecorderPlayerRef.current;
      if (!recorder || !isRecording) {
        return;
      }

      // 触觉反馈
      Vibration.vibrate(50);

      setIsRecording(false);
      onRecordingStateChange?.(false);

      // 清理定时器
      if (waveformIntervalRef.current) {
        clearInterval(waveformIntervalRef.current);
        waveformIntervalRef.current = null;
      }

      // 移除录音监听器
      // recorder.removeRecordBackListener();

      // 停止录音
      // const audioPath = await recorder.stopRecorder();
      const audioPath = recordPathRef.current; // 模拟

      const duration = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const finalWaveform = [...waveformData];
      
      console.log('录音结束:', { audioPath, duration, waveformPoints: finalWaveform.length });

      // 检查录音时长
      if (duration < minDuration) {
        Alert.alert('提示', `录音时间太短，至少需要${minDuration}秒`);
        return;
      }

      // 上传和发送音频（包含声纹数据）
      await uploadAndSendAudio(audioPath, duration, finalWaveform);
    } catch (error) {
      console.error('停止录音失败:', error);
      Alert.alert('错误', '录音结束失败');
      setIsRecording(false);
      onRecordingStateChange?.(false);
    }
  }, [isRecording, minDuration, onRecordingStateChange]);

  // 上传并发送音频
  const uploadAndSendAudio = useCallback(async (audioPath: string, duration: number, waveform: number[]) => {
    setIsUploading(true);
    try {
      // 在实际项目中，这里需要实现文件上传逻辑
      // 可能需要使用 FormData 和 fetch/axios 上传到服务器
      
      // 模拟上传过程
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 模拟上传返回的URL
      const uploadedUrl = `https://example.com/audio/${Date.now()}.m4a`;
      
      // 发送音频消息（包含声纹数据）
      onSendAudio(uploadedUrl, duration, waveform);
      
      Alert.alert('成功', '语音消息发送成功');
    } catch (error) {
      console.error('上传音频失败:', error);
      Alert.alert('错误', '语音消息发送失败，请重试');
    } finally {
      setIsUploading(false);
      setRecordingTime(0);
      setWaveformData([]);
      setCurrentVolume(0);
    }
  }, [onSendAudio]);

  // 取消录音
  const cancelRecording = useCallback(async () => {
    try {
      const recorder = audioRecorderPlayerRef.current;
      if (recorder && isRecording) {
        // recorder.stopRecorder();
        // recorder.removeRecordBackListener();
      }
      
      // 清理定时器
      if (waveformIntervalRef.current) {
        clearInterval(waveformIntervalRef.current);
        waveformIntervalRef.current = null;
      }
      
      setIsRecording(false);
      setRecordingTime(0);
      setWaveformData([]);
      setCurrentVolume(0);
      onRecordingStateChange?.(false);
      
      Vibration.vibrate(100);
    } catch (error) {
      console.error('取消录音失败:', error);
    }
  }, [isRecording, onRecordingStateChange]);

  // 格式化录音时间显示
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 根据录音状态显示不同的UI
  if (isUploading) {
    return (
      <View style={styles.container}>
        <View style={styles.uploadingContainer}>
          <Text style={styles.uploadingText}>正在发送语音...</Text>
        </View>
      </View>
    );
  }

  if (isRecording) {
    return (
      <View style={styles.container}>
        <View style={styles.recordingContainer}>
          <Text style={styles.recordingText}>正在录音 {formatTime(recordingTime)}</Text>
          <Text style={styles.hintText}>松开发送，向上滑动取消</Text>
          
          {/* 简化的声纹可视化 */}
          <View style={styles.waveformContainer}>
            <View style={styles.waveformBars}>
              {waveformData.slice(-20).map((volume, index) => (
                <View
                  key={index}
                  style={[
                    styles.waveformBar,
                    { 
                      height: Math.max(2, volume * 2), // 映射到像素高度
                      opacity: index === waveformData.slice(-20).length - 1 ? 1 : 0.6,
                    },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.volumeText}>音量: {currentVolume}/31</Text>
          </View>
          
          <View style={styles.recordingControls}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={cancelRecording}
            >
              <Text style={styles.cancelButtonText}>取消</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.stopButton}
              onPress={stopRecording}
            >
              <Text style={styles.stopButtonText}>发送</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // 默认录音按钮
  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.recordButton}
        onPress={startRecording}
        disabled={hasPermission === false}
      >
        <Text style={styles.recordButtonText}>
          {hasPermission === false ? '🎤❌' : '🎤'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.blue30,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  recordButtonText: {
    fontSize: 20,
  },
  recordingContainer: {
    padding: 16,
    backgroundColor: Colors.red50,
    borderRadius: 12,
    alignItems: 'center',
    minWidth: 200,
  },
  recordingText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Colors.white,
    marginBottom: 8,
  },
  hintText: {
    fontSize: 12,
    color: Colors.white,
    opacity: 0.8,
    marginBottom: 16,
  },
  recordingControls: {
    flexDirection: 'row',
    gap: 16,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.grey60,
    borderRadius: 8,
  },
  cancelButtonText: {
    color: Colors.white,
    fontWeight: 'bold',
  },
  stopButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.green30,
    borderRadius: 8,
  },
  stopButtonText: {
    color: Colors.white,
    fontWeight: 'bold',
  },
  uploadingContainer: {
    padding: 16,
    backgroundColor: Colors.blue50,
    borderRadius: 12,
    alignItems: 'center',
  },
  uploadingText: {
    fontSize: 14,
    color: Colors.white,
  },
  waveformContainer: {
    alignItems: 'center',
    marginVertical: 16,
    minHeight: 60,
  },
  waveformBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 40,
    gap: 2,
  },
  waveformBar: {
    width: 3,
    backgroundColor: Colors.white,
    borderRadius: 1.5,
    minHeight: 2,
  },
  volumeText: {
    fontSize: 10,
    color: Colors.white,
    opacity: 0.8,
    marginTop: 8,
  },
});

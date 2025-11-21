/**
 * 简洁的录音组件
 * 基于 Telegram TT 架构重新设计
 * 
 * 核心改进：
 * - 使用简洁的 useVoiceRecording Hook
 * - 移除复杂的全局状态备用机制
 * - 简化状态管理和UI逻辑
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Icon } from 'tailchat-design';
// @ts-ignore
import { showErrorToasts, showSuccessToasts, uploadFile, parseUrlStr, t } from 'tailchat-shared';
import { useVoiceRecording } from '../../../hooks/useVoiceRecording';
import { getMessageTextDecorators } from '@/plugin/common';
import { useAppDispatch, useUserId, chatActions } from '../../../../../shared';
import _uniqueId from 'lodash/uniqueId';
import type { InputStateManager } from '@/types/inputState';
import { StateTransitionEvent } from '@/types/inputState';
import { 
  checkMicrophonePermissionStatus, 
  type PermissionStatus 
} from '../../../utils/microphonePermission';
import './AudioRecorder.less';

interface SimpleAudioRecorderProps {
  onSendAudio: (audioUrl: string, duration: number, waveform?: number[]) => void;
  inputStateManager?: InputStateManager;
  recordingStateRef?: { current: HTMLDivElement | null };
  converseId?: string;
  groupId?: string;
}

// 录制状态显示组件
interface RecordingStateProps {
  duration: number;
  waveform: number[];
  onCancel: () => void; // 结束录音（不发送）
  onSend: () => void;   // 结束录音并发送
}

const RecordingState = React.memo(({ 
  duration, 
  waveform, 
  onCancel, 
  onSend
}: RecordingStateProps) => {
  
  const waveformCanvasRef = useRef(null as HTMLCanvasElement | null);

  // 🎵 实时渲染波形 - 基于 Telegram TT 的实现
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas || !waveform.length) {
      return;
    }

    // 🎵 Telegram 紧凑风格的波形渲染
    const SPIKE_WIDTH = 2;
    const SPIKE_STEP = 3;  // 🔧 更紧凑的间距
    const SPIKE_RADIUS = 1;
    const HEIGHT = 20;     // 🔧 更小的高度
    
    // 🎯 动态调整显示策略 - 确保所有波形点都可见
    const maxWidth = 160;  // 紧凑显示区域
    const maxVisiblePoints = Math.floor(maxWidth / SPIKE_STEP); // 53个点
    
    // 🔧 只显示最近的N个点，确保实时变化可见
    const visibleWaveform = waveform.length > maxVisiblePoints 
      ? waveform.slice(-maxVisiblePoints)  // 显示最后53个点
      : waveform;
    
    const width = Math.max(visibleWaveform.length * SPIKE_STEP, 80);
    const height = HEIGHT;

    // 双分辨率渲染（学习 Telegram TT）
    canvas.width = width * 2;
    canvas.height = height * 2;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, width, height);

    // 计算波形峰值
    const peak = Math.max(...visibleWaveform, 1);
    const fillStyle = '#3390EC'; // 蓝色波形

    // 绘制每个波形点
    visibleWaveform.forEach((spike, i) => {
      ctx.fillStyle = fillStyle;
      const spikeHeight = Math.max(2, HEIGHT * (spike / 255)); // 基于 0-255 范围
      const x = i * SPIKE_STEP;
      const y = (height - spikeHeight) / 2;
      
      // 绘制圆角矩形（学习 Telegram TT）
      drawRoundedRect(ctx, x, y, SPIKE_WIDTH, spikeHeight, SPIKE_RADIUS);
      ctx.fill();
    });
  }, [waveform]);

  // 🔧 圆角矩形绘制函数（基于 Telegram TT）
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

  // 格式化录制时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const recordingDuration = Math.floor(duration / 1000);

  return (
    <div className="recording-state-compact">
      {/* 🎵 Telegram 风格紧凑录音界面 */}
      <div className="compact-recording-controls">
        <button 
          className="stop-button-compact"
          onClick={onCancel}
          aria-label={t('结束录音')}
          title={t('结束录音（不发送）')}
        >
          <Icon icon="mdi:stop" />
        </button>
        
        {/* 🎨 紧凑的波形显示区域 */}
        <div className="compact-waveform-area">
          <canvas 
            ref={waveformCanvasRef}
            className="compact-waveform-canvas"
          />
          <span className="compact-recording-time">
            {formatTime(recordingDuration)}
          </span>
        </div>
        
        <button 
          className="send-button-compact"
          onClick={onSend}
          disabled={recordingDuration < 1}
          aria-label={t('发送录音')}
          title={t('发送录音')}
        >
          <Icon icon="mdi:send" />
        </button>
      </div>
    </div>
  );
});

export function SimpleAudioRecorder({ onSendAudio, inputStateManager, recordingStateRef, converseId, groupId }: SimpleAudioRecorderProps) {
  const {
    isRecording,
    currentRecordTime,
    waveform,
    recordButtonRef,
    startRecording,
    stopRecording,
    pauseRecording,
  } = useVoiceRecording();
  const [isUploading, setIsUploading] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState(null as PermissionStatus | null);
  const startTimeRef = useRef(undefined as number | undefined);
  const dispatch = useAppDispatch();
  const userId = useUserId();
  
  // 已移除环形声纹上传动画相关状态

  // 🔒 检查麦克风权限状态
  useEffect(() => {
    const checkPermissions = async () => {
      try {
        const status = await checkMicrophonePermissionStatus();
        setPermissionStatus(status);
      } catch (error) {
        console.error('[SimpleAudioRecorder] 权限检查失败:', error);
        setPermissionStatus({
          supported: false,
          granted: false,
          canRequest: false,
          error: '权限检查失败'
        });
      }
    };

    checkPermissions();
  }, []);

  // 计算录制时长
  const recordingDuration = currentRecordTime && isRecording && startTimeRef.current
    ? Math.max(0, currentRecordTime - startTimeRef.current)
    : 0;

  // 已移除声纹旋转动画逻辑

  // 开始录音 - 学习 Telegram TT 的简洁方法
  const handleStartRecording = useCallback(async () => {
    try {
      // 记录开始时间用于计算duration
      startTimeRef.current = Date.now();
      
      // 🚀 直接启动录音，让 getUserMedia 在用户交互时被调用
      await startRecording();
      
      // 录音启动成功后，通知状态管理器
      if (inputStateManager) {
        const success = inputStateManager.transition(StateTransitionEvent.START_RECORDING);
        if (!success) {
          console.warn(t('录音已启动但状态管理器转换失败'));
        }
      }
      
      // 录音成功后重新检查权限状态
      const newStatus = await checkMicrophonePermissionStatus();
      setPermissionStatus(newStatus);
      
    } catch (error) {
      console.error(t('录音启动失败') + ':', error);
      
      // 🎯 根据具体错误类型提供用户指导
      let errorMessage = t('录音启动失败');
      if (error instanceof Error) {
        if (error.message.includes('NotAllowedError') || error.message.includes('Permission denied')) {
          errorMessage = t('麦克风权限被拒绝，请点击地址栏的锁图标重新允许后重试');
        } else if (error.message.includes('NotFoundError')) {
          errorMessage = t('未找到麦克风设备，请检查设备连接');
        } else if (error.message.includes('NotReadableError')) {
          errorMessage = t('麦克风被其他应用占用，请关闭其他应用后重试');
        } else {
          errorMessage = error.message;
        }
      }
      
      showErrorToasts(errorMessage);
      
      // 录音启动失败，确保状态管理器处于正确状态
      if (inputStateManager) {
        inputStateManager.transition(StateTransitionEvent.CANCEL_RECORDING);
      }
    }
  }, [startRecording, inputStateManager]);

  // 停止录音并上传（无声纹旋转动画）
  const handleStopRecording = useCallback(async () => {
    try {
      setIsUploading(true);
      
      const result = await stopRecording();
      if (!result) {
        showErrorToasts(t('录音失败，请重试'));
        return;
      }

      const { blob, duration, waveform: recordedWaveform } = result;

      // 立即退出录音模式，释放输入框，不再等待上传完成
      startTimeRef.current = undefined;
      if (inputStateManager) {
        inputStateManager.transition(StateTransitionEvent.STOP_RECORDING);
      }

      // 在消息区先追加一个本地占位语音卡片（使用本地blob url），并在该作用域内跟踪自己的占位消息
      try {
        if (converseId) {
          const blobUrl = URL.createObjectURL(blob);

          // 压缩/裁剪波形数据（与 ChatInputBox 保持一致）
          const waveformStr = recordedWaveform && Array.isArray(recordedWaveform) && recordedWaveform.length > 0 ? (() => {
            const INPUT_WAVEFORM_LENGTH = 63;
            let compressedWaveform = recordedWaveform;
            if (recordedWaveform.length > INPUT_WAVEFORM_LENGTH) {
              const step = recordedWaveform.length / INPUT_WAVEFORM_LENGTH;
              compressedWaveform = [] as number[];
              for (let i = 0; i < INPUT_WAVEFORM_LENGTH; i++) {
                const idx = Math.floor(i * step);
                compressedWaveform.push(recordedWaveform[idx] || 0);
              }
            }
            return btoa(JSON.stringify(compressedWaveform));
          })() : undefined;

          const tempCardData: any = {
            type: 'audio',
            url: blobUrl,
            duration: String(duration),
          };
          if (waveformStr) {
            tempCardData.waveform = waveformStr;
          }
          const tempContent = getMessageTextDecorators().card(
            `[语音 ${Math.floor(duration)}"]`,
            tempCardData
          );

          const localMessageId = _uniqueId('localAudio_');
          dispatch(
            chatActions.appendLocalMessage({
              author: userId,
              localMessageId,
              payload: {
                converseId,
                groupId,
                content: tempContent,
                meta: {
                  audio: {
                    url: blobUrl,
                    duration: Math.floor(Number(duration) || 0),
                    waveform: recordedWaveform,
                  },
                },
              },
            })
          );

          // 🎯 上传文件到服务器
          try {
            const uploadResult = await uploadFile(blob, { usage: 'audio.webm' });
            const audioUrl = parseUrlStr(uploadResult.url);
            onSendAudio(audioUrl, duration, recordedWaveform);
            // 删除本地占位并回收本地URL
            dispatch(
              chatActions.deleteMessageById({
                converseId,
                messageId: localMessageId,
              })
            );
            URL.revokeObjectURL(blobUrl);
            showSuccessToasts(t('录音发送成功'));
          } catch (uploadError) {
            console.error(t('录音上传失败') + ':', uploadError);
            showErrorToasts(t('录音上传失败，请重试'));
            // 标记占位消息为失败
            dispatch(
              chatActions.updateMessageInfo({
                messageId: localMessageId,
                message: {
                  converseId,
                  sendFailed: true,
                },
              })
            );
          }
        }
      } catch (e) {
        // 忽略本地回显异常，继续上传
      }

    } catch (error) {
      console.error(t('录音处理失败') + ':', error);
      showErrorToasts(t('录音发送失败，请重试'));
    } finally {
      setIsUploading(false);
      // 已在点击发送时切换到 STOP_RECORDING，这里不再重复
    }
  }, [stopRecording, onSendAudio, inputStateManager]);

  // 结束录音（不发送）- 完全停止录音并清理所有资源
  const handleStopRecordingWithoutSend = useCallback(async () => {
    try {
      await stopRecording();
      startTimeRef.current = undefined;
      
      // 通知状态管理器录音结束
      if (inputStateManager) {
        inputStateManager.transition(StateTransitionEvent.CANCEL_RECORDING);
      }
    } catch (error) {
      console.error(t('停止录音失败') + ':', error);
      // 确保状态管理器知道停止了
      if (inputStateManager) {
        inputStateManager.transition(StateTransitionEvent.CANCEL_RECORDING);
      }
    }
  }, [stopRecording, inputStateManager]);


  return (
    <>
      {/* 录音按钮容器 */}
      <div style={{ position: 'relative', display: 'inline-block' }}>
        {/* 录音按钮 */}
        <button
          ref={recordButtonRef}
          className={`audio-recorder-button ${isRecording ? 'recording' : ''} ${
            permissionStatus && !permissionStatus.supported ? 'unsupported' : ''
          } ${
            permissionStatus && !permissionStatus.granted && !permissionStatus.canRequest ? 'permission-denied' : ''
          }`}
          onClick={handleStartRecording}
          disabled={
            isRecording || 
            !permissionStatus?.supported
            // 🚀 学习 Telegram TT：移除权限预检查，让用户总能尝试录音
          }
          aria-label={
            isRecording ? t('录音中...') :
            !permissionStatus?.supported ? t('不支持录音') :
            t('开始录音')
          }
          title={
            isRecording ? t('录音中，请在输入框操作') :
            !permissionStatus?.supported ? t('您的浏览器不支持录音功能') :
            t('点击开始录音')
          }
        >
          <Icon icon={
            !permissionStatus?.supported ? "mdi:microphone-off" :
            isRecording ? "mdi:microphone" : "mdi:microphone"
          } />
        </button>

        {/* 上传声纹旋转动画已移除 */}
      </div>

      {/* 使用 Portal 将录音状态渲染到主输入区域 */}
      {isRecording && recordingStateRef?.current && ReactDOM.createPortal(
               <RecordingState
                 duration={recordingDuration}
                 waveform={waveform}
                 onCancel={handleStopRecordingWithoutSend}
                 onSend={handleStopRecording}
               />,
        recordingStateRef.current
      )}
    </>
  );
}

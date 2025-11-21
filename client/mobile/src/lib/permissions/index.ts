import { request, check, PERMISSIONS } from 'react-native-permissions';
import { Platform } from 'react-native';

export async function ensureWebRTCPermission() {
  const cameraPermission =
    Platform.OS === 'ios' ? PERMISSIONS.IOS.CAMERA : PERMISSIONS.ANDROID.CAMERA;
  const microphonePermission =
    Platform.OS === 'ios'
      ? PERMISSIONS.IOS.MICROPHONE
      : PERMISSIONS.ANDROID.RECORD_AUDIO;

  const [cameraPermissionStatus, microphonePermissionStatus] =
    await Promise.all([check(cameraPermission), check(microphonePermission)]);

  if (microphonePermissionStatus !== 'granted') {
    await request(microphonePermission);
  }

  if (cameraPermissionStatus !== 'granted') {
    await request(cameraPermission);
  }
}

/**
 * 确保音频录制权限
 * 专门用于语音消息功能
 * @returns Promise<boolean> 是否获得权限
 */
export async function ensureAudioRecordPermission(): Promise<boolean> {
  const microphonePermission =
    Platform.OS === 'ios'
      ? PERMISSIONS.IOS.MICROPHONE
      : PERMISSIONS.ANDROID.RECORD_AUDIO;

  try {
    const permissionStatus = await check(microphonePermission);
    
    if (permissionStatus === 'granted') {
      return true;
    }

    if (permissionStatus === 'denied' || permissionStatus === 'blocked') {
      const requestResult = await request(microphonePermission);
      return requestResult === 'granted';
    }

    // 未确定状态，尝试请求权限
    const requestResult = await request(microphonePermission);
    return requestResult === 'granted';
  } catch (error) {
    console.error('获取录音权限失败:', error);
    return false;
  }
}

/**
 * 检查音频录制权限状态
 * @returns Promise<'granted' | 'denied' | 'blocked' | 'unavailable'>
 */
export async function checkAudioRecordPermission() {
  const microphonePermission =
    Platform.OS === 'ios'
      ? PERMISSIONS.IOS.MICROPHONE
      : PERMISSIONS.ANDROID.RECORD_AUDIO;

  try {
    return await check(microphonePermission);
  } catch (error) {
    console.error('检查录音权限失败:', error);
    return 'unavailable' as const;
  }
}

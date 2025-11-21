/**
 * 麦克风权限管理工具
 * 基于 Telegram TT 的最佳实践
 */

export interface PermissionStatus {
  supported: boolean;
  granted: boolean;
  canRequest: boolean;
  error?: string;
}

export interface MicrophoneTestResult extends PermissionStatus {
  stream?: MediaStream;
}

/**
 * 检查浏览器是否支持录音功能
 */
export function isMicrophoneSupported(): boolean {
  return Boolean(
    window.navigator?.mediaDevices &&
    'getUserMedia' in window.navigator.mediaDevices &&
    (window.AudioContext || (window as any).webkitAudioContext)
  );
}

/**
 * 检查麦克风权限状态（不会触发权限请求）
 */
export async function checkMicrophonePermissionStatus(): Promise<PermissionStatus> {
  if (!isMicrophoneSupported()) {
    return {
      supported: false,
      granted: false,
      canRequest: false,
      error: '您的浏览器不支持录音功能'
    };
  }

  try {
    // 优先使用 Permissions API（如果支持）
    if ('permissions' in navigator) {
      try {
        const permissionResult = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        
        switch (permissionResult.state) {
          case 'granted':
            return { supported: true, granted: true, canRequest: true };
          case 'denied':
            return { 
              supported: true, 
              granted: false, 
              canRequest: false,
              error: '麦克风权限已被拒绝，请在浏览器设置中重新允许'
            };
          case 'prompt':
          default:
            return { supported: true, granted: false, canRequest: true };
        }
      } catch (error) {
        // Firefox 等浏览器不支持 microphone 权限查询
        console.warn('[Permission] Permissions API not supported for microphone:', error);
      }
    }

    // 回退到基本检查
    return { supported: true, granted: false, canRequest: true };
  } catch (error) {
    return {
      supported: false,
      granted: false,
      canRequest: false,
      error: `权限检查失败: ${error instanceof Error ? error.message : '未知错误'}`
    };
  }
}

/**
 * 测试麦克风权限和功能（会触发权限请求）
 * 基于 Telegram TT 的实现方式
 */
export async function testMicrophoneAccess(): Promise<MicrophoneTestResult> {
  const basicStatus = await checkMicrophonePermissionStatus();
  
  if (!basicStatus.supported) {
    return basicStatus;
  }

  if (!basicStatus.canRequest) {
    return basicStatus;
  }

  try {
    // 使用与录音相同的音频配置进行测试
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
      }
    });

    // 检查是否真的获得了音频轨道
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stream.getTracks().forEach(track => track.stop());
      return {
        supported: true,
        granted: false,
        canRequest: false,
        error: '无法访问麦克风设备，请检查设备连接'
      };
    }

    // 测试成功，但立即停止以释放资源
    stream.getTracks().forEach(track => track.stop());
    
    return {
      supported: true,
      granted: true,
      canRequest: true,
      stream // 注意：这里的 stream 已经停止，仅用于验证
    };

  } catch (error: any) {
    console.error('[Microphone] Access test failed:', error);
    
    // 根据错误类型提供具体的用户指导
    let errorMessage = '麦克风访问失败';
    
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      errorMessage = '麦克风权限被拒绝，请点击地址栏的锁图标重新允许';
    } else if (error.name === 'NotFoundError' || error.name === 'DeviceNotFoundError') {
      errorMessage = '未找到麦克风设备，请检查设备连接';
    } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      errorMessage = '麦克风设备被其他应用占用，请关闭其他使用麦克风的应用';
    } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
      errorMessage = '麦克风设备不支持所需的音频格式';
    } else if (error.name === 'NotSupportedError') {
      errorMessage = '浏览器不支持录音功能，请使用更新的浏览器';
    } else if (error.name === 'SecurityError') {
      errorMessage = '由于安全限制无法访问麦克风，请确保使用 HTTPS';
    }

    return {
      supported: true,
      granted: false,
      canRequest: error.name !== 'NotAllowedError',
      error: errorMessage
    };
  }
}

/**
 * 获取用户友好的权限状态描述
 */
export function getPermissionStatusDescription(status: PermissionStatus): string {
  if (!status.supported) {
    return '您的浏览器不支持录音功能，请使用 Chrome、Firefox 或 Safari 等现代浏览器。';
  }
  
  if (status.granted) {
    return '麦克风权限已获得，可以开始录音。';
  }
  
  if (!status.canRequest) {
    return status.error || '麦克风权限已被永久拒绝，请在浏览器设置中重新允许后刷新页面。';
  }
  
  return '需要麦克风权限才能录音，点击录音按钮时将会请求权限。';
}

/**
 * 获取权限修复指导
 */
export function getPermissionFixGuide(): string[] {
  const isChrome = /Chrome/.test(navigator.userAgent);
  const isFirefox = /Firefox/.test(navigator.userAgent);
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  
  if (isChrome) {
    return [
      '1. 点击地址栏左侧的锁图标或摄像头图标',
      '2. 选择"始终允许访问麦克风"',
      '3. 刷新页面重新尝试'
    ];
  } else if (isFirefox) {
    return [
      '1. 点击地址栏左侧的盾牌图标',
      '2. 关闭"阻止音频设备访问"',
      '3. 刷新页面重新尝试'
    ];
  } else if (isSafari) {
    return [
      '1. 点击 Safari 菜单 > 偏好设置 > 网站',
      '2. 选择"麦克风"，允许此网站使用麦克风',
      '3. 刷新页面重新尝试'
    ];
  }
  
  return [
    '1. 查找浏览器地址栏附近的权限图标',
    '2. 允许此网站访问麦克风',
    '3. 刷新页面重新尝试'
  ];
}

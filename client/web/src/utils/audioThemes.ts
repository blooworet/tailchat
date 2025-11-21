/**
 * 音频组件主题配置系统
 * 基于Telegram TT的颜色方案设计
 * 
 * 功能：
 * - 定义各主题的音频组件色彩方案
 * - 波形条颜色、背景色、按钮色配置
 * - 主题切换时的颜色映射
 * - 与Tailchat整体设计风格统一
 */

export interface AudioThemeColors {
  // 播放器背景和边框
  background: string;
  backgroundOwn: string;
  border: string;
  borderOwn: string;
  
  // 文本颜色
  text: string;
  textSecondary: string;
  
  // 波形颜色
  waveform: {
    fill: string;           // 未播放部分
    progressFill: string;   // 已播放部分
    ownFill: string;        // Own消息未播放部分
    ownProgressFill: string; // Own消息已播放部分
  };
  
  // 播放按钮
  button: {
    background: string;
    backgroundOwn: string;
    hover: string;
    hoverOwn: string;
    text: string;
    disabled: string;
  };
  
  // 状态颜色
  states: {
    loading: string;
    error: string;
    success: string;
  };
  
  // 交互效果
  interaction: {
    hover: string;
    active: string;
    focus: string;
  };
}

// 亮色主题配置
export const lightThemeColors: AudioThemeColors = {
  background: 'rgba(243, 244, 246, 0.8)',
  backgroundOwn: 'rgba(239, 246, 255, 0.9)',
  border: 'rgba(209, 213, 219, 1)',
  borderOwn: 'rgba(147, 197, 253, 0.8)',
  
  text: 'rgba(31, 41, 55, 1)',
  textSecondary: 'rgba(107, 114, 128, 1)',
  
  waveform: {
    fill: '#ADD3F7',
    progressFill: '#3390EC',
    ownFill: '#AEDFA4',
    ownProgressFill: '#4FAE4E',
  },
  
  button: {
    background: '#3390EC',
    backgroundOwn: '#4FAE4E',
    hover: '#2563EB',
    hoverOwn: '#22C55E',
    text: '#FFFFFF',
    disabled: 'rgba(156, 163, 175, 1)',
  },
  
  states: {
    loading: '#6B7280',
    error: '#EF4444',
    success: '#10B981',
  },
  
  interaction: {
    hover: 'rgba(0, 0, 0, 0.05)',
    active: 'rgba(0, 0, 0, 0.1)',
    focus: 'rgba(99, 102, 241, 0.35)',
  },
};

// 暗色主题配置
export const darkThemeColors: AudioThemeColors = {
  background: 'rgba(31, 41, 55, 0.8)',
  backgroundOwn: 'rgba(55, 65, 81, 0.9)',
  border: 'rgba(75, 85, 99, 1)',
  borderOwn: 'rgba(156, 163, 175, 0.8)',
  
  text: 'rgba(243, 244, 246, 1)',
  textSecondary: 'rgba(156, 163, 175, 1)',
  
  waveform: {
    fill: '#494A78',
    progressFill: '#8774E1',
    ownFill: '#B7ABED',
    ownProgressFill: '#FFFFFF',
  },
  
  button: {
    background: '#8774E1',
    backgroundOwn: '#6366F1',
    hover: '#7C3AED',
    hoverOwn: '#4F46E5',
    text: '#FFFFFF',
    disabled: 'rgba(75, 85, 99, 1)',
  },
  
  states: {
    loading: '#9CA3AF',
    error: '#F87171',
    success: '#34D399',
  },
  
  interaction: {
    hover: 'rgba(255, 255, 255, 0.05)',
    active: 'rgba(255, 255, 255, 0.1)',
    focus: 'rgba(139, 92, 246, 0.35)',
  },
};

// Miku主题配置（青绿色系）
export const mikuThemeColors: AudioThemeColors = {
  background: 'rgba(57, 197, 187, 0.1)',
  backgroundOwn: 'rgba(57, 197, 187, 0.15)',
  border: 'rgba(57, 197, 187, 0.3)',
  borderOwn: 'rgba(57, 197, 187, 0.4)',
  
  text: '#39C5BB',
  textSecondary: 'rgba(57, 197, 187, 0.8)',
  
  waveform: {
    fill: 'rgba(57, 197, 187, 0.5)',
    progressFill: '#39C5BB',
    ownFill: 'rgba(57, 197, 187, 0.7)',
    ownProgressFill: '#2DD4BF',
  },
  
  button: {
    background: '#39C5BB',
    backgroundOwn: '#2DD4BF',
    hover: '#2DD4BF',
    hoverOwn: '#14B8A6',
    text: '#FFFFFF',
    disabled: 'rgba(57, 197, 187, 0.3)',
  },
  
  states: {
    loading: '#6B7280',
    error: '#F87171',
    success: '#10B981',
  },
  
  interaction: {
    hover: 'rgba(57, 197, 187, 0.1)',
    active: 'rgba(57, 197, 187, 0.2)',
    focus: 'rgba(57, 197, 187, 0.35)',
  },
};

// Telegram主题配置（蓝色系）
export const telegramThemeColors: AudioThemeColors = {
  background: 'rgba(74, 162, 242, 0.1)',
  backgroundOwn: 'rgba(74, 162, 242, 0.15)',
  border: 'rgba(74, 162, 242, 0.3)',
  borderOwn: 'rgba(74, 162, 242, 0.4)',
  
  text: '#4aa2f2',
  textSecondary: 'rgba(74, 162, 242, 0.8)',
  
  waveform: {
    fill: 'rgba(74, 162, 242, 0.5)',
    progressFill: '#4aa2f2',
    ownFill: 'rgba(74, 162, 242, 0.7)',
    ownProgressFill: '#0088cc',
  },
  
  button: {
    background: '#4aa2f2',
    backgroundOwn: '#0088cc',
    hover: '#0088cc',
    hoverOwn: '#006699',
    text: '#FFFFFF',
    disabled: 'rgba(74, 162, 242, 0.3)',
  },
  
  states: {
    loading: '#6B7280',
    error: '#F87171',
    success: '#10B981',
  },
  
  interaction: {
    hover: 'rgba(74, 162, 242, 0.1)',
    active: 'rgba(74, 162, 242, 0.2)',
    focus: 'rgba(74, 162, 242, 0.35)',
  },
};

// 主题映射
export const AUDIO_THEMES = {
  light: lightThemeColors,
  dark: darkThemeColors,
  miku: mikuThemeColors,
  telegram: telegramThemeColors,
} as const;

export type AudioThemeName = keyof typeof AUDIO_THEMES;

/**
 * 获取音频主题颜色
 * @param themeName 主题名称
 * @returns 主题颜色配置
 */
export function getAudioThemeColors(themeName: AudioThemeName = 'light'): AudioThemeColors {
  return AUDIO_THEMES[themeName] || AUDIO_THEMES.light;
}

/**
 * 根据系统偏好自动选择主题
 * @returns 推荐的主题名称
 */
export function getPreferredAudioTheme(): AudioThemeName {
  // 检查系统暗色模式偏好
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  }
  return 'light';
}

/**
 * 生成CSS变量映射
 * @param colors 主题颜色配置
 * @returns CSS变量对象
 */
export function generateAudioCSSVariables(colors: AudioThemeColors): Record<string, string> {
  return {
    // 播放器背景和边框
    '--tc-audio-bg': colors.background,
    '--tc-audio-bg-own': colors.backgroundOwn,
    '--tc-audio-border': colors.border,
    '--tc-audio-border-own': colors.borderOwn,
    
    // 文本颜色
    '--tc-audio-text': colors.text,
    '--tc-audio-text-secondary': colors.textSecondary,
    
    // 波形颜色
    '--tc-audio-waveform-fill': colors.waveform.fill,
    '--tc-audio-waveform-progress': colors.waveform.progressFill,
    '--tc-audio-waveform-own-fill': colors.waveform.ownFill,
    '--tc-audio-waveform-own-progress': colors.waveform.ownProgressFill,
    
    // 播放按钮
    '--tc-audio-btn-bg': colors.button.background,
    '--tc-audio-btn-bg-own': colors.button.backgroundOwn,
    '--tc-audio-btn-hover': colors.button.hover,
    '--tc-audio-btn-hover-own': colors.button.hoverOwn,
    '--tc-audio-btn-text': colors.button.text,
    '--tc-audio-btn-disabled': colors.button.disabled,
    
    // 状态颜色
    '--tc-audio-loading': colors.states.loading,
    '--tc-audio-error': colors.states.error,
    '--tc-audio-success': colors.states.success,
    
    // 交互效果
    '--tc-audio-hover': colors.interaction.hover,
    '--tc-audio-active': colors.interaction.active,
    '--tc-audio-focus': colors.interaction.focus,
  };
}

/**
 * 应用音频主题到DOM
 * @param themeName 主题名称
 * @param element 目标元素，默认为document.documentElement
 */
export function applyAudioTheme(
  themeName: AudioThemeName,
  element: HTMLElement = document.documentElement
): void {
  if (typeof document === 'undefined') return;

  const colors = getAudioThemeColors(themeName);
  const cssVariables = generateAudioCSSVariables(colors);

  // 应用CSS变量到元素
  Object.entries(cssVariables).forEach(([property, value]) => {
    element.style.setProperty(property, value);
  });

  // 添加主题类名
  element.classList.remove('tc-audio-theme-light', 'tc-audio-theme-dark', 'tc-audio-theme-miku', 'tc-audio-theme-telegram');
  element.classList.add(`tc-audio-theme-${themeName}`);
}

/**
 * 监听系统主题变化
 * @param callback 主题变化回调
 * @returns 清理函数
 */
export function watchSystemThemeChange(
  callback: (isDark: boolean) => void
): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return () => {};
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  
  const handleChange = (e: MediaQueryListEvent) => {
    callback(e.matches);
  };

  // 兼容不同浏览器的API
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  } else if (mediaQuery.addListener) {
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }

  return () => {};
}

/**
 * 获取对比度颜色（用于确保文本可读性）
 * @param backgroundColor 背景色
 * @param lightColor 浅色文本
 * @param darkColor 深色文本
 * @returns 推荐的文本颜色
 */
export function getContrastColor(
  backgroundColor: string,
  lightColor: string = '#FFFFFF',
  darkColor: string = '#000000'
): string {
  // 简单的对比度计算，实际项目中可以使用更精确的算法
  const rgb = backgroundColor.match(/\d+/g);
  if (!rgb || rgb.length < 3) return darkColor;

  const [r, g, b] = rgb.map(Number);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  
  return brightness > 128 ? darkColor : lightColor;
}

/**
 * 创建主题切换动画
 * @param element 目标元素
 * @param duration 动画时长（毫秒）
 */
export function createThemeTransition(
  element: HTMLElement = document.documentElement,
  duration: number = 300
): void {
  if (typeof document === 'undefined') return;

  const transitionProperty = 'background-color, border-color, color, fill, stroke';
  const originalTransition = element.style.transition;

  element.style.transition = `${transitionProperty} ${duration}ms ease`;

  setTimeout(() => {
    element.style.transition = originalTransition;
  }, duration);
}

export default {
  AUDIO_THEMES,
  getAudioThemeColors,
  getPreferredAudioTheme,
  generateAudioCSSVariables,
  applyAudioTheme,
  watchSystemThemeChange,
  getContrastColor,
  createThemeTransition,
};

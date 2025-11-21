/**
 * Canvas波形渲染引擎
 * 基于Telegram TT的实现 (telegram-tt/src/components/common/helpers/waveform.ts)
 * 
 * 核心功能：
 * - 高分辨率Canvas渲染（2x scale）
 * - 圆角波形条绘制算法
 * - 进度高亮和透明度控制
 */

export interface WaveformRenderConfig {
  spikeWidth?: number;     // 波形条宽度，默认2
  spikeStep?: number;      // 波形条间距，默认4
  spikeRadius?: number;    // 波形条圆角半径，默认1
  height?: number;         // 波形高度，默认23
  minSpikeHeight?: number; // 最小波形条高度，默认2
}

export interface WaveformColors {
  fillStyle: string;           // 普通填充色
  progressFillStyle: string;   // 进度填充色
}

export interface RenderWaveformOptions {
  canvas: HTMLCanvasElement;
  spikes: number[];
  progress: number;            // 0-1的播放进度
  peak: number;               // 峰值，用于归一化
  colors: WaveformColors;
  config?: WaveformRenderConfig;
  containerWidth?: number;     // 容器宽度，用于响应式渲染
}

// 默认配置（与Telegram TT保持一致）
const DEFAULT_CONFIG: Required<WaveformRenderConfig> = {
  spikeWidth: 2,
  spikeStep: 4,
  spikeRadius: 1,
  height: 23,
  minSpikeHeight: 2
};

export const MAX_EMPTY_WAVEFORM_POINTS = 30;

/**
 * 渲染波形到Canvas
 * 
 * @param options 渲染选项
 */
export function renderWaveform(options: RenderWaveformOptions): void {
  const {
    canvas,
    spikes,
    progress,
    peak,
    colors,
    config = {},
    containerWidth
  } = options;

  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const { spikeWidth, spikeRadius, height, minSpikeHeight } = finalConfig;
  let { spikeStep } = finalConfig;

  if (!canvas || !spikes.length) {
    // 清空画布
    clearCanvas(canvas);
    return;
  }

  // 🎯 响应式宽度计算
  let width: number;
  if (containerWidth && containerWidth > 0) {
    // 使用容器宽度，响应式布局
    width = Math.max(containerWidth - 20, 200); // 留20px边距，最小200px
    spikeStep = Math.max(3, Math.floor(width / spikes.length)); // 重新计算间距
  } else {
    // 传统方式：基于spikes数量
    width = spikes.length * spikeStep;
  }
  
  // 设置高分辨率Canvas（2倍分辨率）
  canvas.width = width * 2;
  canvas.height = height * 2;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('无法获取Canvas 2D上下文');
    return;
  }

  // 应用2倍缩放以支持高DPI显示
  ctx.scale(2, 2);
  
  // 清空画布
  ctx.clearRect(0, 0, width, height);

  // 计算自适应的spike宽度
  const adaptiveSpikeWidth = containerWidth && containerWidth > 0 
    ? Math.max(spikeWidth, spikeStep - 2) // 响应式：确保适当的间距
    : spikeWidth; // 传统模式

  // 渲染每个波形条
  spikes.forEach((spike, index) => {
    const progressPosition = index / spikes.length;
    const isActive = progress > progressPosition;
    
    // 设置透明度和颜色
    ctx.globalAlpha = isActive ? 1.0 : 0.5;
    ctx.fillStyle = isActive ? colors.progressFillStyle : colors.fillStyle;
    
    // 计算波形条高度（归一化到峰值）
    const normalizedPeak = Math.max(1, peak);
    const spikeHeight = Math.max(minSpikeHeight, height * (spike / normalizedPeak));
    
    // 计算位置
    const x = index * spikeStep;
    const y = (height - spikeHeight) / 2;
    
    // 绘制圆角矩形波形条
    drawRoundedRectangle(ctx, x, y, adaptiveSpikeWidth, spikeHeight, spikeRadius);
    ctx.fill();
  });
  
  // 重置透明度
  ctx.globalAlpha = 1.0;
}

/**
 * 绘制圆角矩形
 * 
 * @param ctx Canvas 2D上下文
 * @param x X坐标
 * @param y Y坐标
 * @param width 宽度
 * @param height 高度
 * @param radius 圆角半径
 */
function drawRoundedRectangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  // 限制圆角半径
  if (width < 2 * radius) {
    radius = width / 2;
  }
  if (height < 2 * radius) {
    radius = height / 2;
  }

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/**
 * 清空Canvas
 * 
 * @param canvas Canvas元素
 */
export function clearCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * 根据进度计算波形高亮位置
 * 
 * @param spikes 波形数据
 * @param progress 播放进度 (0-1)
 * @returns 高亮到第几个spike
 */
export function calculateHighlightPosition(spikes: number[], progress: number): number {
  return Math.floor(spikes.length * progress);
}

/**
 * 计算波形总宽度
 * 
 * @param spikeCount 波形条数量
 * @param config 配置选项
 * @returns 总宽度（像素）
 */
export function calculateWaveformWidth(spikeCount: number, config?: WaveformRenderConfig): number {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  return spikeCount * finalConfig.spikeStep;
}

/**
 * 根据Canvas宽度计算最佳spike数量
 * 
 * @param canvasWidth Canvas宽度
 * @param config 配置选项
 * @returns 最佳spike数量
 */
export function calculateOptimalSpikeCount(canvasWidth: number, config?: WaveformRenderConfig): number {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  return Math.floor(canvasWidth / finalConfig.spikeStep);
}

/**
 * WaveformRenderer类
 * 提供面向对象的波形渲染接口
 */
export class WaveformRenderer {
  private canvas: HTMLCanvasElement;
  private config: Required<WaveformRenderConfig>;
  private lastRenderTime = 0;
  private animationFrameId: number | null = null;

  constructor(canvas: HTMLCanvasElement, config?: WaveformRenderConfig) {
    this.canvas = canvas;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 渲染波形
   * 
   * @param spikes 波形数据
   * @param progress 播放进度
   * @param peak 峰值
   * @param colors 颜色配置
   */
  render(spikes: number[], progress: number, peak: number, colors: WaveformColors): void {
    renderWaveform({
      canvas: this.canvas,
      spikes,
      progress,
      peak,
      colors,
      config: this.config
    });
  }

  /**
   * 动画渲染波形（带帧率限制）
   * 
   * @param spikes 波形数据
   * @param progress 播放进度
   * @param peak 峰值
   * @param colors 颜色配置
   * @param maxFPS 最大帧率，默认30fps
   */
  animatedRender(
    spikes: number[], 
    progress: number, 
    peak: number, 
    colors: WaveformColors,
    maxFPS: number = 30
  ): void {
    const now = performance.now();
    const interval = 1000 / maxFPS;
    
    if (now - this.lastRenderTime >= interval) {
      this.render(spikes, progress, peak, colors);
      this.lastRenderTime = now;
    }
  }

  /**
   * 清空画布
   */
  clear(): void {
    clearCanvas(this.canvas);
  }

  /**
   * 更新配置
   * 
   * @param newConfig 新的配置
   */
  updateConfig(newConfig: Partial<WaveformRenderConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取当前配置
   */
  getConfig(): Required<WaveformRenderConfig> {
    return { ...this.config };
  }

  /**
   * 取消动画帧
   */
  cancelAnimation(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * 销毁渲染器
   */
  destroy(): void {
    this.cancelAnimation();
    this.clear();
  }
}

/**
 * 创建WaveformRenderer的便捷函数
 * 
 * @param canvas Canvas元素
 * @param config 配置选项
 * @returns WaveformRenderer实例
 */
export function createWaveformRenderer(
  canvas: HTMLCanvasElement, 
  config?: WaveformRenderConfig
): WaveformRenderer {
  return new WaveformRenderer(canvas, config);
}

/**
 * 检查Canvas是否支持2D渲染
 * 
 * @param canvas Canvas元素
 * @returns boolean 是否支持
 */
export function isCanvas2DSupported(canvas: HTMLCanvasElement): boolean {
  try {
    const ctx = canvas.getContext('2d');
    return ctx !== null;
  } catch (error) {
    return false;
  }
}

/**
 * 获取设备像素比
 * 
 * @returns number 设备像素比
 */
export function getDevicePixelRatio(): number {
  return window.devicePixelRatio || 1;
}

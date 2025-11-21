/**
 * 图片生成工具模块
 */
const { createCanvas } = require('canvas');
const config = require('../config');

/**
 * 生成带文字的图片
 * @param {string} text - 要显示的文字
 * @returns {Buffer} - 图片 Buffer
 */
function generateTextImage(text) {
  const { width, height, fontSize, background, text: textConfig } = config.IMAGE_CONFIG;
  
  // 创建画布
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 绘制背景渐变
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, background.gradient.start);
  gradient.addColorStop(1, background.gradient.end);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // 设置文字样式
  ctx.fillStyle = textConfig.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // 根据文字长度动态调整字体大小
  let currentFontSize = fontSize.default;
  if (text.length > 20) {
    currentFontSize = fontSize.small;
  } else if (text.length > 10) {
    currentFontSize = fontSize.medium;
  }
  // 使用支持中文的字体：Noto Sans CJK SC (简体中文), DejaVu Sans (英文后备)
  ctx.font = `bold ${currentFontSize}px "Noto Sans CJK SC", "DejaVu Sans", sans-serif`;

  // 添加文字阴影效果
  ctx.shadowColor = textConfig.shadowColor;
  ctx.shadowBlur = textConfig.shadowBlur;
  ctx.shadowOffsetX = textConfig.shadowOffset.x;
  ctx.shadowOffsetY = textConfig.shadowOffset.y;

  // 绘制文字（居中）
  ctx.fillText(text, width / 2, height / 2);

  // 添加底部装饰线
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = textConfig.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(100, height - 80);
  ctx.lineTo(width - 100, height - 80);
  ctx.stroke();

  // 添加小字说明（使用相同的字体）
  ctx.font = '20px "Noto Sans CJK SC", "DejaVu Sans", sans-serif';
  ctx.fillText('Created by TextBuild Bot', width / 2, height - 40);

  return canvas.toBuffer('image/png');
}

module.exports = {
  generateTextImage,
};


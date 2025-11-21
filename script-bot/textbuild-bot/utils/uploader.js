/**
 * 文件上传工具模块
 */
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

/**
 * 上传图片到 Tailchat
 * @param {Object} client - Tailchat 客户端实例
 * @param {Buffer} imageBuffer - 图片 Buffer
 * @returns {Promise<{url: string, etag: string, path: string}>}
 */
async function uploadImage(client, imageBuffer) {
  // 方式 1: 使用 SDK 的 call 方法（推荐）
  try {
    // 创建临时文件
    const tempFileName = `textbuild_${Date.now()}.png`;
    const tempFilePath = path.join('/tmp', tempFileName);
    fs.writeFileSync(tempFilePath, imageBuffer);
    
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(tempFilePath), {
        filename: tempFileName,
        contentType: 'image/png',
      });
      form.append('usage', 'chat');

      // 使用 client.request，它会自动添加正确的认证头
      const response = await client.request.post('/upload', form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      return response.data;
    } finally {
      // 清理临时文件
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    }
  } catch (error) {
    // 详细错误日志
    console.error('文件上传失败:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      headers: error.response?.headers,
    });
    
    // 输出请求配置信息
    console.error('请求配置:', {
      url: error.config?.url,
      method: error.config?.method,
      baseURL: error.config?.baseURL,
      hasXAppSecret: error.config?.headers?.['X-App-Secret'] ? '✅' : '❌',
    });
    
    // 输出服务器返回的具体错误信息
    if (error.response?.data) {
      console.error('服务器错误响应:', JSON.stringify(error.response.data, null, 2));
    }
    
    throw new Error(`文件上传失败: ${error.response?.status || error.message}`);
  }
}

module.exports = {
  uploadImage,
};


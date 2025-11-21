import posthog from 'posthog-js';
import { sharedEvent } from '@capital/common';

try {
  posthog.init('phc_xRCv3qbbOBMQkz31kbYMngXxn7Ey5JMu0BZIFktO6km', {
    api_host: 'https://app.posthog.com',
    autocapture: false, // 关闭autocapture以节约事件用量
    disable_session_recording: true, // 关闭自动录屏(不需要且一直报错)
  });

  const PLUGIN_NAME = 'posthog';

  console.log(`Plugin ${PLUGIN_NAME} is loaded`);

  setTimeout(() => {
    console.log('Report plugin install status');

    try {
      const d = window.localStorage['$TailchatInstalledPlugins'];
      if (!d) {
        posthog.capture('Report Plugin', {
          plugins: [],
          pluginNum: 0,
          pluginRaw: '',
        });
        return;
      }
      const storage = JSON.parse(d);
      const list = storage.rawData;
      if (!list || !Array.isArray(list)) {
        // 格式不匹配
        return;
      }

      posthog.capture('Report Plugin', {
        plugins: list.map((item) => item.name), // 主要收集名称列表
        pluginNum: list.length,
        pluginRaw: JSON.stringify(list), // 原始信息
      });
    } catch (err) {
      // Ignore error
    }
  }, 2000);

  sharedEvent.on('loginSuccess', (userInfo) => {
    posthog.identify(userInfo._id, {
      email: userInfo.email,
      username: userInfo.username ? `@${userInfo.username}` : userInfo.nickname,
      avatar: userInfo.avatar,
      temporary: userInfo.temporary,
    });
  });

  sharedEvent.on('appLoaded', () => {
    // 上报加载耗时，使用安全的时间获取方式
    const getPerformanceTime = () => {
      try {
        // 动态导入以避免模块加载时的错误
        const { safePerformanceNow } = require('@/utils/performance-safe');
        return safePerformanceNow();
      } catch (error) {
        console.warn('Failed to get safe performance time:', error);
        return Date.now();
      }
    };

    posthog.capture('App Loaded', {
      usage: getPerformanceTime(),
    });
  });
} catch (err) {
  console.error(err);
}

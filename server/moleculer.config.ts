import {
  defaultBrokerConfig,
  config,
  BrokerOptions,
} from 'tailchat-server-sdk';

const brokerConfig: BrokerOptions = {
  ...defaultBrokerConfig,
};

if (config.feature.disableLogger === true) {
  brokerConfig.logger = false;
}

if (config.feature.disableInfoLog === true) {
  brokerConfig.logLevel = 'error';
}

if (config.feature.disableTracing === true) {
  brokerConfig.tracing = undefined;
}

// Windows环境下的Performance API兼容性问题：在Windows开发环境下禁用tracing
// 这可以解决 "TypeError: Value of 'this' must be of type Performance" 错误
// 可以通过环境变量 FORCE_ENABLE_TRACING=true 来强制启用tracing
if (process.platform === 'win32' && 
    process.env.NODE_ENV !== 'production' && 
    process.env.FORCE_ENABLE_TRACING !== 'true') {
  console.warn('[Tailchat] Windows开发环境下禁用tracing以避免Performance API兼容性问题');
  console.warn('[Tailchat] 如需启用，请设置环境变量 FORCE_ENABLE_TRACING=true');
  brokerConfig.tracing = undefined;
}

// 确保生产环境启用 cacher（默认内存，可由环境覆盖为 Redis 等）
if (!brokerConfig.cacher) {
  // 若外部未显式提供，则回落到内存缓存以支持 nonce/限流
  (brokerConfig as any).cacher = {
    type: 'Memory',
    options: {
      ttl: 60,
      maxParamsLength: 100,
    },
  } as any;
}

export default brokerConfig;

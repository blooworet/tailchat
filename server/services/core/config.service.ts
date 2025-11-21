import { TcService, TcContext } from 'tailchat-server-sdk';
import _ from 'lodash';
import { config } from 'tailchat-server-sdk';
import os from 'os';
import { buildUploadUrl } from 'tailchat-server-sdk';
import ConfigModel from '../../models/config';

export default class ConfigService extends TcService {
  get serviceName(): string {
    return 'config';
  }

  onInit(): void {
    this.registerLocalDb(ConfigModel);
    
    this.registerAction('all', this.all, {
      cache: {
        keys: [],
        ttl: 60 * 60, // 1 hour
      },
    });

    this.registerAction('client', this.client, {
      cache: {
        keys: [],
        ttl: 60 * 60, // 1 hour
      },
    });

    this.registerAction('setClientConfig', this.setClientConfig, {
      params: {
        key: 'string',
        value: 'any',
      },
    });

    this.registerAction('list', this.list);
  }

  all() {
    return config;
  }

  /**
   * 获取完整配置信息
   */
  async client() {
    const persistConfig = await this.adapter.model.getAllClientPersistConfig();
    const { ip, hostname, type } = await this.getServerInfo();

    // 客户端内核版本
    const coreVersion = (this.broker as any).nodeInfo?.$node?.properties
      ?.version;

    // 白名单机制是否开启
    const emailFilterEnabled =
      typeof process.env.ADMIN_EMAIL_FILTER === 'string' &&
      process.env.ADMIN_EMAIL_FILTER.trim() !== '';

    // 提供一个设备唯一标识
    // 编码 IP + hostname + CPU + startupAt
    // 注: 不能使用过于敏感的信息，因为会在客户端暴露
    const id = Buffer.from(
      `${ip}.${hostname}.${type}.${
        (this.broker.nodeID ?? '').split('-', 2)[1] ?? ''
      }.${((this.broker as any).started ?? 0) % 86400000}`,
      'utf8'
    ).toString('base64');

    const version = '1.9.2';

    return {
      version,
      coreVersion,
      uploadFileLimit: config.storage.limit,
      serverName: process.env.SERVER_NAME,
      emailFilterEnabled,
      emailAllowDomain: process.env.EMAIL_ALLOW_DOMAIN,
      disableUserRegister: config.feature.disableUserRegister,
      disableGuestLogin: config.feature.disableGuestLogin,
      disableCreateGroup: config.feature.disableCreateGroup,
      disablePluginStore: config.feature.disablePluginStore,
      disableAddFriend: config.feature.disableAddFriend,
      serverConfigAddress: process.env.SERVER_CONFIG_ADDRESS,
      serverConfigHost: process.env.SERVER_CONFIG_HOST,
      id,
      ...persistConfig,
    };
  }

  /**
   * 设置客户端配置
   * 
   * 通常由管理员调用
   */
  async setClientConfig(
    ctx: TcContext<{
      key: string;
      value: any;
    }>
  ) {
    const { key, value } = ctx.params;
    const newConfig = await this.adapter.model.setClientPersistConfig(
      key,
      value
    );
    await this.cleanActionCache('client', []);
    this.broadcastNotify(ctx, 'updateClientConfig', newConfig);
  }

  /**
   * 列出系统信息
   */
  async list() {
    const {
      hostname,
      ip,
      port,
      server,
      serverHealthy,
      serverId,
      serverName,
      servicesCount,
      logger,
      events,
      req,
      metrics,
      env,
    } = await this.getServerInfo();

    const status = {
      hostname,
      ip,
      port,
      server,
      serverHealthy,
      serverId,
      serverName,
      servicesCount,
      events,
      logger,
      metrics,
      env,
      config: this.getClientConfig(req),
    };

    return status;
  }

  /**
   * 获取配置状态
   */
  getClientConfig(req: any) {
    const clientConfig: any = {
      uploadFileLimit: this.formatSize(config.storage.limit),
      serverUrl: config.apiUrl,
      uploadUrl: buildUploadUrl(''),
    };

    const plugins: any = [];

    return toJSONSafe({ clientConfig, plugins });
  }

  /**
   * 格式化内存尺寸
   */
  formatSize(size: number) {
    if (size >= 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    } else if (size >= 1024) {
      return `${(size / 1024).toFixed(2)} KB`;
    } else {
      return `${size} Byte`;
    }
  }

  /**
   * 获取服务器信息
   */
  async getServerInfo() {
    try {
      const ifaces = os.networkInterfaces();
      let ip = '';
      for (const dev in ifaces) {
        ifaces[dev]
          ?.filter((details) => details.family === 'IPv4')
          .forEach((details) => {
            if (!details.internal) {
              ip = details.address;
            }
          });
      }
      return {
        hostname: os.hostname(),
        type: os.type(),
        ip,
        port: process.env.PORT || 11000,
        serverName: process.env.SERVER_NAME || 'Tailchat',
        server: (this.broker as any).nodeID,
        serverHealthy: true,
        serverId: 1,
        servicesCount: 0,
        version: '0.1.0',
        logger: this.logger,
        events: {
          active: 'emit',
          async: false,
        },
        req: undefined,
        metrics: {},
        env: process.env.NODE_ENV || 'production',
      };
    } catch (err) {
      console.error('[ConfigService] getServerInfo Error:', err);
      throw err;
    }
  }
}

/**
 * 简单的JSON序列化安全函数
 */
function toJSONSafe(input: any): any {
  if (input === null || input === undefined) {
    return input;
  }
  
  try {
    // 简单的序列化处理，不进行复杂的转换
    return JSON.parse(JSON.stringify(input));
  } catch (e) {
    console.warn('[toJSONSafe Config] Serialization failed:', e);
    return { 
      error: 'Serialization failed', 
      message: String(e) 
    };
  }
}

/**
 * 估算对象的深度，仅用于调试性能瓶颈点
 */
function estimateDepth(val: any, maxDepth = 10, seen = new WeakSet()): number {
  if (val === null || val === undefined) return 0;
  if (typeof val !== 'object') return 0;
  if (seen.has(val)) return 0; // 避免循环引用
  seen.add(val);
  if (maxDepth <= 0) return 1; // 到达最大深度，停止递归但记1层
  
  let maxChildDepth = 0;
  try {
    if (Array.isArray(val)) {
      for (let i = 0; i < Math.min(val.length, 10); i++) {
        const childDepth = estimateDepth(val[i], maxDepth - 1, seen);
        maxChildDepth = Math.max(maxChildDepth, childDepth);
      }
    } else {
      const keys = Object.keys(val).slice(0, 10);
      for (const k of keys) {
        try {
          const childDepth = estimateDepth(val[k], maxDepth - 1, seen);
          maxChildDepth = Math.max(maxChildDepth, childDepth);
        } catch {}
      }
    }
  } catch {}
  
  return 1 + maxChildDepth;
}

/**
 * 调试：逐 key 打印类型与估算深度；局部尝试 stringify，并捕获异常
 */
function debugPrintObjectKeys(
  logger: { info: (...args: any[]) => void; warn?: (...args: any[]) => void },
  label: string,
  obj: any
) {
  try {
    if (!obj || typeof obj !== 'object') {
      logger.info('[Config.client][debug]', label, 'is not object:', typeof obj);
      return;
    }
    const keys = Object.keys(obj);
    logger.info('[Config.client][debug]', label, 'keys=', keys.length);
    for (const k of keys) {
      const v = (obj as any)[k];
      const type = describeType(v);
      const depth = estimateDepth(v, 6);
      let ser = 'ok';
      try {
        // 不打印结果，只验证是否可序列化；避免过大输出
        JSON.stringify(v);
      } catch (e) {
        ser = 'fail';
      }
      logger.info(
        '[Config.client][debug] key=',
        k,
        'type=',
        type,
        'depth≈',
        depth,
        'json=',
        ser
      );
    }
  } catch (e) {
    try {
      logger.warn?.('[Config.client][debug] print error:', String(e));
    } catch {}
  }
}

function describeType(val: any): string {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (Array.isArray(val)) return 'array';
  const type = typeof val;
  if (type !== 'object') return type;
  const constructor = val.constructor?.name;
  if (constructor && constructor !== 'Object') return `object:${constructor}`;
  return 'object';
}
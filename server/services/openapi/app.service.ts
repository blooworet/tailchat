import {
  TcService,
  config,
  TcDbService,
  TcContext,
  EntityError,
  NoPermissionError,
} from 'tailchat-server-sdk';
import _ from 'lodash';
import {
  filterAvailableAppCapability,
  OpenApp,
  OpenAppBot,
  OpenAppDocument,
  OpenAppModel,
  OpenAppOAuth,
} from '../../models/openapi/app';
import { Types } from 'mongoose';
import { nanoid } from 'nanoid';
import crypto from 'crypto';

interface OpenAppService
  extends TcService,
    TcDbService<OpenAppDocument, OpenAppModel> {}
class OpenAppService extends TcService {
  get serviceName(): string {
    return 'openapi.app';
  }

  // 已移除：命令变更推送与埋点

  onInit(): void {
    if (!config.enableOpenapi) {
      return;
    }

    this.registerLocalDb(require('../../models/openapi/app').default);
    
    // 指定公开字段
    this.registerDbField([
      '_id',
      'owner',
      'appId',
      'appSecret',
      'appName',
      'appDesc',
      'appIcon',
      'capability',
      'oauth',
      'bot',
      'createdAt',
      'updatedAt',
    ]);

    this.registerAction('authToken', this.authToken, {
      params: {
        token: 'string',
        capability: { type: 'array', items: 'string', optional: true },
      },
      cache: {
        keys: ['token'],
        ttl: 60 * 60, // 1 hour
      },
    });

    // 已移除：命令更新广播统计接口
    this.registerAction('all', this.all);
    this.registerAction('get', this.get, {
      params: {
        appId: { type: 'string', optional: true },
        appSecret: { type: 'string', optional: true },
      },
      cache: {
        keys: ['appId', 'appSecret'],
        ttl: 60 * 5, // 5 min
      },
    });
    
    this.registerAction('findById', this.findById, {
      params: {
        id: 'string',
      },
      cache: {
        keys: ['id'],
        ttl: 60 * 60, // 1 hour
      },
    });
    
    this.registerAction('findByAppId', this.findByAppId, {
      params: {
        appId: 'string',
      },
      cache: {
        keys: ['appId'],
        ttl: 60 * 60, // 1 hour
      },
    });
    this.registerAction('findByAppIdInternal', this.findByAppIdInternal, {
      params: {
        appId: 'string',
      },
      cache: {
        keys: ['appId'],
        ttl: 60 * 60, // 1 hour
      },
    });
    this.registerAction('getForIntegration', this.getForIntegration, {
      params: {
        appId: { type: 'string', optional: true },
        appSecret: { type: 'string', optional: true },
      },
      cache: {
        keys: ['appId', 'appSecret'],
        ttl: 60 * 60, // 1 hour
      },
    });
    this.registerAction('getPublicByAppId', this.getPublicByAppId, {
      params: {
        appId: 'string',
      },
      cache: {
        keys: ['appId'],
        ttl: 60 * 60, // 1 hour
      },
    });
    this.registerAction('create', this.create, {
      params: {
        appName: 'string',
        appDesc: 'string',
        appIcon: 'string',
      },
    });
    this.registerAction('delete', this.delete, {
      params: {
        appId: { type: 'string', optional: true },
        appSecret: { type: 'string', optional: true },
      },
    });
    this.registerAction('setAppInfo', this.setAppInfo, {
      params: {
        appId: { type: 'string', optional: true },
        appSecret: { type: 'string', optional: true },
        fieldName: 'string',
        fieldValue: 'string',
      },
    });
    this.registerAction('setAppCapability', this.setAppCapability, {
      params: {
        appId: { type: 'string', optional: true },
        appSecret: { type: 'string', optional: true },
        capability: { type: 'array', items: 'string' },
      },
    });
    this.registerAction('setAppOAuthInfo', this.setAppOAuthInfo, {
      params: {
        appId: { type: 'string', optional: true },
        appSecret: { type: 'string', optional: true },
        fieldName: 'string',
        fieldValue: 'any',
      },
    });
    this.registerAction('setAppBotInfo', this.setAppBotInfo, {
      params: {
        appId: { type: 'string', optional: true },
        appSecret: { type: 'string', optional: true },
        fieldName: 'string',
        fieldValue: 'any',
      },
    });
    this.registerAction('getBotCommands', this.getBotCommands, {
      params: {
        appId: 'string',
        ifVersion: { type: 'number', optional: true },
        ifEtag: { type: 'string', optional: true },
      },
      cache: {
        keys: ['appId'],
        ttl: 60 * 60, // 1 hour - 延长缓存时间，因为命令不经常变化
      },
    });

    // 新增：获取机器人命令元数据（版本/etag）
    this.registerAction('getBotCommandMeta', this.getBotCommandMeta, {
      params: {
        appId: 'string',
      },
      visibility: 'published',
    });
    // 新增：按机器人用户ID列表获取命令（按需加载优化 - 前端主导方案）
    this.registerAction('getBotCommandsByUserIds', this.getBotCommandsByUserIds, {
      params: {
        botUserIds: { type: 'array', items: 'string' },
        converseId: 'string',
        groupId: { type: 'string', optional: true },
        ifVersion: { type: 'number', optional: true },
        ifEtag: { type: 'string', optional: true },
      },
      visibility: 'published',
    });
    
    // 新增：按范围获取机器人命令的缓存接口
    this.registerAction('getBotCommandsByScope', this.getBotCommandsByScope, {
      params: {
        appId: 'string',
        scopeType: 'string',
        chatId: { type: 'string', optional: true },
        userId: { type: 'string', optional: true },
        ifVersion: { type: 'number', optional: true },
        ifEtag: { type: 'string', optional: true },
      },
      cache: {
        keys: ['appId', 'scopeType', 'chatId', 'userId'],
        ttl: 60 * 60, // 1 hour
      },
    });

  }

  /**
   * 解析复合 appSecret（格式: "<appId>:<secret>")
   */
  private parseCompositeSecret(token: string): { appId: string; secret: string } {
    if (typeof token !== 'string') throw new Error('Invalid token');
    const idx = token.indexOf(':');
    if (idx <= 0 || idx >= token.length - 1) {
      throw new Error('Invalid appSecret format');
    }
    const appId = token.slice(0, idx);
    const secret = token.slice(idx + 1);
    return { appId, secret };
  }

  /**
   * 校验Token 返回true/false
   *
   * Token 就是 appSecret 本身
   */
  async authToken(
    ctx: TcContext<{
      token: string;
      capability?: OpenAppDocument['capability'];
    }>
  ): Promise<boolean> {
    const { token, capability } = ctx.params;
    // 新格式: token = "<appId>:<secret>"
    const { appId } = this.parseCompositeSecret(token);
    const app = await this.adapter.model.findOne({ appId });

    if (!app) {
      // 没有找到应用
        throw new Error('Not found open app with the provided token');
    }
    // 校验密钥：完整匹配（"appid:secret" 一体化密钥）
    if (typeof app.appSecret !== 'string') {
      throw new Error('Invalid app secret stored');
    }
    const stored = String(app.appSecret);
    if (stored !== token) {
      throw new Error('Open app secret not match');
    }

    if (Array.isArray(capability)) {
      for (const item of capability) {
        if (!app.capability.includes(item)) {
          throw new Error('Open app not enabled capability:' + item);
        }
      }
    }

    return true;
  }

  /**
   * 获取用户参与的所有应用
   */
  async all(ctx: TcContext<{}>) {
    const apps = await this.adapter.model.find({
      owner: ctx.meta.userId,
    });

    return await this.transformDocuments(ctx, {}, apps);
  }

  /**
   * 获取应用信息
   * 如果只提供appId，则允许公开访问（用于群组集成等场景），但不暴露敏感信息
   * 如果提供appSecret，则需要所有者验证（用于私密操作），返回完整信息
   */
  async get(ctx: TcContext<{ appId?: string; appSecret?: string }>) {
    const { appId, appSecret } = ctx.params;
    const userId = ctx.meta.userId;

    if (!appId && !appSecret) {
      throw new Error('Either appId or appSecret must be provided');
    }

    const query: any = {};
    let isOwnerAccess = false;

    if (appSecret) {
      // 如果提供了appSecret，需要所有者验证（私密访问）
      query.owner = userId;
      query.appSecret = appSecret;
      isOwnerAccess = true;
    } else if (appId) {
      // 如果只提供appId，允许公开访问（群组集成等场景）
      query.appId = appId;
    }

    const app = await this.adapter.model.findOne(query);

    if (!app) {
      throw new Error('Not found openapp');
    }

    const result = await this.transformDocuments(ctx, {}, app);

    // get 接口总是移除敏感信息，用于公开访问场景（如群组集成）
    if (result) {      
      delete result.appSecret;
      // 如果 result 有 data 属性，也需要删除其中的敏感信息
      if (result.data) {
        delete result.data.appSecret;
      }
    }

    return result;
  }
  
  /**
   * 通过ID获取应用信息
   */
  async findById(ctx: TcContext<{ id: string }>) {
    const id = ctx.params.id;
    const userId = ctx.meta.userId;

    // 添加权限控制：只能查看自己拥有的应用
    const app = await this.adapter.model.findOne({
      _id: id,
      owner: userId, // 只能查看自己的应用
    });

    if (!app) {
        throw new Error('Not found openapp or no permission');
    }

    return await this.transformDocuments(ctx, {}, app);
  }
  
  /**
   * 通过appId获取应用信息（需要权限验证）
   */
  async findByAppId(ctx: TcContext<{ appId: string }>) {
    const appId = ctx.params.appId;
    const userId = ctx.meta.userId;

    // 添加权限控制：只能查看自己拥有的应用
    const app = await this.adapter.model.findOne({
      appId,
      owner: userId, // 只能查看自己的应用
    });

    if (!app) {
        throw new Error('Not found openapp or no permission');
    }

    return await this.transformDocuments(ctx, {}, app);
  }

  /**
   * 通过appId获取应用信息（系统内部使用，无权限检查）
   */
  async findByAppIdInternal(ctx: TcContext<{ appId: string }>) {
    const appId = ctx.params.appId;

    const app = await this.adapter.model.findOne({
      appId
    });

    return await this.transformDocuments(ctx, {}, app);
  }

  /**
   * 获取应用信息（用于机器人集成，无权限检查）
   * 专门用于机器人API调用场景，需要 appSecret 认证
   */
  async getForIntegration(ctx: TcContext<{ appId?: string; appSecret?: string }>) {
    const { appId, appSecret } = ctx.params;

    if (!appId && !appSecret) {
      throw new Error('Either appId or appSecret must be provided');
    }

    if (appSecret) {
      const { appId: parsedAppId } = this.parseCompositeSecret(appSecret);
      const appDoc = await this.adapter.model.findOne({ appId: parsedAppId });
      if (!appDoc) {
        throw new Error('Not found openapp');
      }
      const stored = String(appDoc.appSecret || '');
      if (stored !== appSecret) {
        throw new Error('Open app secret not match');
      }
      return await this.transformDocuments(ctx, {}, appDoc);
    }

    const app = await this.adapter.model.findOne({ appId });

    if (!app) {
      throw new Error('Not found openapp');
    }

    return await this.transformDocuments(ctx, {}, app);
  }

  /**
   * 通过 appId 获取应用的公开信息
   * 专门用于群组添加机器人等公开场景
   */
  async getPublicByAppId(ctx: TcContext<{ appId: string }>) {
    const { appId } = ctx.params;

    const app = await this.adapter.model.findOne({
      appId
    });

    if (!app) {
      throw new Error('Not found openapp');
    }

    return await this.transformDocuments(ctx, {}, app);
  }


  /**
   * 创建一个第三方应用
   */
  async create(
    ctx: TcContext<{
      appName: string;
      appDesc: string;
      appIcon: string;
    }>
  ) {
    const { appName, appDesc, appIcon } = ctx.params;
    const userId = ctx.meta.userId;

    if (!appName) {
      throw new EntityError();
    }

    // 生成有身份特点的 appSecret
    // 格式: app_{appName简化}_{userId片段}_{随机字符串}
    let appNameSlug;
    // 首先尝试提取英文和数字
    const latinChars = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    if (latinChars.length > 0) {
      // 如果有英文或数字，使用这些字符
      appNameSlug = latinChars.substring(0, 10);
    } else {
      // 如果全是非拉丁字符（如中文、日文等），使用简单哈希处理
      // 使用一种简单的哈希方法生成可读字符串
      const simpleHash = crypto.createHash('md5').update(appName).digest('hex').substring(0, 10);
      appNameSlug = simpleHash;
    }
    const userIdFragment = userId.substring(userId.length - 8); // 取用户ID的最后8位
    const randomPart = nanoid(8); // 添加8位随机字符保证唯一性
    const timestamp = Date.now().toString(36).substring(0, 4); // 时间戳编码为base36，取前4位
    

    // 生成 appId：取消 tc_ 前缀，取 ObjectId 前 10 位
    const rawObjectId = new Types.ObjectId().toString();
    const generatedAppId = rawObjectId.substring(0, 10);

    // 生成 appSecret：先对拼接串做 sha256，再随机插入 1 个下划线（不在首尾）
    const baseConcat = `${appNameSlug}${userIdFragment}${timestamp}${randomPart}`;
    const sha256Hex = crypto.createHash('sha256').update(baseConcat).digest('hex');
    const base35 = sha256Hex.slice(0, 35);
    const insertPos = Math.floor(Math.random() * (base35.length - 2)) + 1; // [1, len-2]
    const generatedSecret = `${base35.slice(0, insertPos)}_${base35.slice(insertPos)}`;

    const doc = await this.adapter.model.create({
      owner: String(userId),
      appId: generatedAppId,
      appSecret: `${generatedAppId}:${generatedSecret}`,
      appName,
      appDesc,
      appIcon,
      // 默认不启用任何功能，用户需要手动启用
      capability: [],
    });

    const result = await this.transformDocuments(ctx, {}, doc);

    return result;
  }

  /**
   * 删除开放平台应用
   */
  async delete(
    ctx: TcContext<{
      appId?: string;
      appSecret?: string;
    }>
  ) {
    const { appId, appSecret } = ctx.params;
    const userId = ctx.meta.userId;
    const t = ctx.meta.t;

    if (!appId && !appSecret) {
      throw new Error('Either appId or appSecret must be provided');
    }

    // 直接查询数据库，确保权限控制
    const findQuery: any = {
      owner: userId, // 只能删除自己的应用
    };

    if (appId) {
      findQuery.appId = appId;
    } else if (appSecret) {
      findQuery.appSecret = appSecret;
    }

    const appInfo = await this.adapter.model.findOne(findQuery);

    if (!appInfo) {
      throw new NoPermissionError(t('没有操作权限'));
    }

    // 可能会出现ws机器人不会立即中断连接的问题，不重要暂时不处理

    // 删除应用记录
    await this.adapter.model.remove(findQuery);

    // 删除应用成功后，清理关联：从私信列表和群聊成员中移除该机器人，并删除机器人用户
    try {
      const botId = 'open_' + appInfo.appId;
      const botEmail = `${botId}@openapi.msgbyte.com`;

      await this.waitForServices(['user', 'chat.converse', 'group']);

      // 尝试找到机器人用户ID
      let botUserId: string | null = null;
      try {
        const botUser = await ctx.call('user.findUserByEmail', { email: botEmail });
        if (botUser && (botUser as any)._id) botUserId = String((botUser as any)._id);
      } catch {}

      // 1) 从所有用户 dmlist 中剔除与机器人相关的 DM/多人会话（仅隐藏）
      if (botUserId) {
        try {
          await ctx.call('chat.converse.adminPruneDMListByMember', {
            memberId: botUserId,
            isAdminOperation: true,
          });
        } catch (e) {
          this.logger.warn('[openapi.cleanup] adminPruneDMListByMember failed:', e);
        }
      }

      // 2) 从所有群聊中移除该机器人（仅移除成员）
      if (botUserId) {
        try {
          await ctx.call('group.adminRemoveMemberFromAllGroups', {
            memberId: botUserId,
            isAdminOperation: true,
          });
        } catch (e) {
          this.logger.warn('[openapi.cleanup] adminRemoveMemberFromAllGroups failed:', e);
        }
      }

      // 3) 最后删除机器人用户（幂等）
      try {
        const result = await ctx.call('user.deleteOpenapiBot', { botEmail });
        if (result) {
          this.logger.info(`Deleted bot user for app: ${appInfo.appId}, bot email: ${botEmail}`);
        }
      } catch (e) {
        this.logger.warn(`Failed to delete bot user for app: ${appInfo.appId}`, e);
      }
    } catch (error) {
      this.logger.warn(`Failed to delete bot user for app: ${appInfo.appId}`, error);
      // 不阻断应用删除流程，只记录警告
    }

    return true;
  }

  /**
   * 修改应用信息
   */
  async setAppInfo(
    ctx: TcContext<{
      appId?: string;
      appSecret?: string;
      fieldName: string;
      fieldValue: string;
    }>
  ) {
    const { appId, appSecret, fieldName, fieldValue } = ctx.params;
    const userId = ctx.meta.userId;
    const t = ctx.meta.t;

    if (!appId && !appSecret) {
      throw new Error('Either appId or appSecret must be provided');
    }

    if (!['appName', 'appDesc', 'appIcon'].includes(fieldName)) {
      // 只允许修改以上字段
      throw new EntityError(`${t('该数据不允许修改')}: ${fieldName}`);
    }

    // 构建查询条件
    const query: any = {
      owner: userId,
    };

    // 优先使用appId查找应用
    if (appId) {
      query.appId = appId;
    } else if (appSecret) {
      query.appSecret = appSecret;
    }

    const doc = await this.adapter.model
      .findOneAndUpdate(
        query,
        {
          [fieldName]: fieldValue,
        },
        {
          new: true,
        }
      )
      .exec();

    if (!doc) {
      throw new Error('Not found openapp');
    }

    // 如果有appSecret则清除缓存
    if (appSecret) {
      this.cleanAppInfoCache(appSecret);
    }

    return await this.transformDocuments(ctx, {}, doc);
  }

  /**
   * 设置应用开放的能力
   * 支持通过appId或appSecret查询应用
   */
  async setAppCapability(
    ctx: TcContext<{
      appId?: string;
      appSecret?: string;
      capability: string[];
    }>
  ) {
    const { appId, appSecret, capability } = ctx.params;
    const { userId } = ctx.meta;
    
    if (!appId && !appSecret) {
      throw new Error('Either appId or appSecret must be provided');
    }

    let openapp;
    
    // 优先使用appId查找应用
    if (appId) {
      openapp = await this.adapter.model.findOne({
        appId: appId,
        owner: userId,
      }).exec();
    } else if (appSecret) {
      openapp = await this.adapter.model.findAppBySecretAndOwner(appSecret, userId);
    }
    
    if (!openapp) {
      throw new Error('Not found openapp');
    }

    await openapp
      .updateOne({
        capability: filterAvailableAppCapability(_.uniq(capability)),
      })
      .exec();

    // 清除缓存
    if (appSecret) {
      await this.cleanAppInfoCache(appSecret);
    }
    
    // 需要获取 appId 来清理相关缓存
    const app = await this.adapter.model.findOne(
      appId ? { appId, owner: userId } : { appSecret, owner: userId }
    );
    
    if (app) {
      // 清除 findByAppIdInternal 和 getPublicByAppId 缓存
      await this.cleanActionCache('findByAppIdInternal', [String(app.appId)]);
      await this.cleanActionCache('getPublicByAppId', [String(app.appId)]);
    }

    return true;
  }

  /**
   * 设置OAuth的设置信息
   */
  async setAppOAuthInfo<T extends keyof OpenAppOAuth>(
    ctx: TcContext<{
      appId?: string;
      appSecret?: string;
      fieldName: T;
      fieldValue: OpenAppOAuth[T];
    }>
  ) {
    const { appId, appSecret, fieldName, fieldValue } = ctx.params;
    const { userId } = ctx.meta;

    if (!appId && !appSecret) {
      throw new Error('Either appId or appSecret must be provided');
    }

    if (!['redirectUrls'].includes(fieldName)) {
      throw new Error('Not allowed fields');
    }

    if (fieldName === 'redirectUrls') {
      if (!Array.isArray(fieldValue)) {
        throw new Error('`redirectUrls` should be an array');
      }
    }

    // 构建查询条件
    const query: any = {
      owner: userId,
    };

    // 优先使用appId查找应用
    if (appId) {
      query.appId = appId;
    } else if (appSecret) {
      query.appSecret = appSecret;
    }

    const result = await this.adapter.model.findOneAndUpdate(
      query,
      {
        $set: {
          [`oauth.${fieldName}`]: fieldValue,
        },
      }
    );

    if (!result) {
      throw new Error('Not found openapp');
    }

    // 清除相关缓存
    if (appSecret) {
      await this.cleanAppInfoCache(appSecret);
    }
    
    // 清除 findByAppIdInternal 缓存（无论是通过 appId 还是 appSecret 更新）
    await this.cleanActionCache('findByAppIdInternal', [String(result.appId)]);
    // 清除 getPublicByAppId 缓存，确保公开信息能及时更新
    await this.cleanActionCache('getPublicByAppId', [String(result.appId)]);
  }

  /**
   * 设置Bot的设置信息
   */
  async setAppBotInfo<T extends keyof OpenAppBot>(
    ctx: TcContext<{
      appId?: string;
      appSecret?: string;
      fieldName: T;
      fieldValue: OpenAppBot[T];
    }>
  ) {
    const { appId, appSecret: appSecretParam, fieldName, fieldValue } = ctx.params;
    const { userId } = ctx.meta as any;
    const isBot = Boolean((ctx.meta as any).isBot);
    const appSecretFromMeta = (ctx.meta as any).appSecret as string | undefined;
    const effectiveAppSecret = appSecretFromMeta || appSecretParam;
    let parsedAppIdFromSecret: string | undefined;
    if (effectiveAppSecret) {
      try {
        parsedAppIdFromSecret = this.parseCompositeSecret(effectiveAppSecret).appId;
      } catch (e) {
        throw new Error('Invalid appSecret format');
      }
    }
    
    // setAppBotInfo 被调用

    if (!appId && !effectiveAppSecret) {
      throw new Error('Either appId or appSecret must be provided');
    }

    if (!['callbackUrl', 'username', 'allowGroup', 'commands', 'receiveAllGroupMessages'].includes(fieldName)) {
      throw new Error('Not allowed fields');
    }

    if (fieldName === 'callbackUrl') {
      if (typeof fieldValue !== 'string') {
        throw new Error('`callbackUrl` should be a string');
      }
    }

    if (fieldName === 'username') {
      if (fieldValue !== null && typeof fieldValue !== 'string') {
        throw new Error('`username` should be a string or null');
      }
      
      // 先查询当前应用，检查是否已经有用户名
      const preQuery: any = {};
      if (effectiveAppSecret && parsedAppIdFromSecret) {
        // 机器人模式：用 appId 精确匹配文档
        preQuery.appId = parsedAppIdFromSecret;
      } else if (appId) {
        preQuery.appId = appId;
        if (!isBot) {
          preQuery.owner = userId; // 仅用户模式校验 owner
        }
      }

      const currentApp = await this.adapter.model.findOne(preQuery);
      if (!currentApp) {
        throw new Error('Not found openapp');
      }
      
      // 如果当前应用已经有用户名，不允许修改
      if (currentApp.bot?.username && fieldValue) {
        throw new Error('Bot username already exists and cannot be modified');
      }
      
      // 如果设置了用户名，需要验证格式和唯一性
      if (fieldValue && typeof fieldValue === 'string') {
        const { validateUsernameStrict } = await import('../../lib/utils');
        
        if (!validateUsernameStrict(fieldValue, { isBot: true })) {
          throw new Error('Invalid bot username format');
        }

        // 检查用户名唯一性
        await this.waitForServices(['user']);
        try {
          const existingUser = await ctx.call('user.findUserByUsername', { 
            username: fieldValue 
          });
          
          if (existingUser) {
            throw new Error('Username already exists');
          }
        } catch (error) {
          // 如果是 DataNotFoundError，说明用户名不存在，这是我们想要的结果
          if (error.name === 'DataNotFoundError') {
            // 用户名可用，继续执行
          } else {
            // 其他错误才是真正的验证失败
            this.logger.error('Failed to check username availability:', error);
            throw new Error('Failed to validate username');
          }
        }
      }
    }

    if (fieldName === 'receiveAllGroupMessages') {
      if (typeof fieldValue !== 'boolean') {
        throw new Error('`receiveAllGroupMessages` should be a boolean');
      }
    }

    if (fieldName === 'allowGroup') {
      if (typeof fieldValue !== 'boolean') {
        throw new Error('`allowGroup` should be a boolean');
      }
    }

    // 准备要保存的值
    let valueToSave = fieldValue;

    if (fieldName === 'commands') {
      if (fieldValue !== null && fieldValue !== undefined) {
        if (!Array.isArray(fieldValue)) {
          throw new Error('`commands` should be an array');
        }
        
        // 数据清理逻辑：保留标准字段，确保向后兼容
        const cleanedCommands = fieldValue.map(cmd => {
          const cleanedCmd: any = {
            command: cmd.command,
            description: cmd.description
          };
          
          // 如果有scope字段，保留它
          if (cmd.scope) {
            cleanedCmd.scope = cmd.scope;
          }
          
          return cleanedCmd;
        });
        
        // 验证每个命令的格式
        for (const command of cleanedCommands) {
          if (!command || typeof command !== 'object') {
            throw new Error('Each command should be an object');
          }
          
          if (!command.command || typeof command.command !== 'string') {
            throw new Error('Command name is required and should be a string');
          }
          
          if (!command.description || typeof command.description !== 'string') {
            throw new Error('Command description is required and should be a string');
          }
          
          // 验证命令名格式（仅允许小写字母、数字、下划线）
          if (!/^[a-z0-9_]+$/.test(command.command)) {
            throw new Error(`Invalid command name format: ${command.command}`);
          }
          
          // 验证命令名长度（最多32个字符）
          if (command.command.length > 32) {
            throw new Error(`Command name too long: ${command.command} (max 32 characters)`);
          }
          
          // 验证描述长度（最多256个字符）
          if (command.description.length > 256) {
            throw new Error(`Command description too long (max 256 characters)`);
          }
          
          // 验证scope字段（如果存在）
          if (command.scope) {
            if (typeof command.scope !== 'object') {
              throw new Error('Command scope should be an object');
            }
            
            const validScopeTypes = ['default', 'all_private_chats', 'all_group_chats', 'chat', 'chat_member'];
            if (!validScopeTypes.includes(command.scope.type)) {
              throw new Error(`Invalid scope type: ${command.scope.type}`);
            }
            
            // 验证条件字段
            if (command.scope.type === 'chat' || command.scope.type === 'chat_member') {
              if (!command.scope.chat_id || typeof command.scope.chat_id !== 'string') {
                throw new Error(`chat_id is required for scope type: ${command.scope.type}`);
              }
            }
            
            if (command.scope.type === 'chat_member') {
              if (!command.scope.user_id || typeof command.scope.user_id !== 'string') {
                throw new Error('user_id is required for scope type: chat_member');
              }
            }
          }
        }
        
        // 检查命令名唯一性
        const commandNames = cleanedCommands.map(cmd => cmd.command);
        const uniqueNames = new Set(commandNames);
        if (commandNames.length !== uniqueNames.size) {
          throw new Error('Command names must be unique');
        }
        
        // 限制命令数量（防止滥用）
        if (cleanedCommands.length > 50) {
          throw new Error('Maximum 50 commands allowed per bot');
        }

        // 使用清理后的数据
        valueToSave = cleanedCommands as any;
      }
    }

    // 构建查询条件
    const query: any = {};
    if (effectiveAppSecret && parsedAppIdFromSecret) {
      query.appId = parsedAppIdFromSecret; // 机器人/开放平台模式按 appId
    } else if (appId) {
      query.appId = appId;
      if (!isBot) {
        query.owner = userId; // 仅用户模式校验 owner
      }
    }


    const result = await this.adapter.model.findOneAndUpdate(
      query,
      {
        $set: {
          [`bot.${fieldName}`]: valueToSave,
        },
      },
      { new: true }
    );

    if (!result) {
      throw new Error('Not found openapp');
    }

    // 如果设置的是用户名，需要立即同步更新机器人用户的用户名
    if (fieldName === 'username') {
      await this.waitForServices(['user']);
      
      // 直接通过 ensureOpenapiBot 确保机器人存在并设置用户名
      // 这样可以确保用户名立即生效，不依赖后续的调用
      const botId = 'open_' + result.appId;
      const nickname = result.appName;
      const avatar = result.appIcon;
      
      await ctx.call('user.ensureOpenapiBot', {
        botId,
        nickname,
        avatar,
        username: fieldValue, // 直接传递 fieldValue，可能是字符串、null 或 undefined
      });
      
      this.logger.info(`Bot username updated for appId: ${result.appId}, username: ${fieldValue || 'cleared'}`);
    }

    // 清除相关缓存
    if (effectiveAppSecret) {
      await this.cleanAppInfoCache(effectiveAppSecret);
    }
    
    // 清除 findByAppIdInternal 缓存（无论是通过 appId 还是 appSecret 更新）
    if (result) {
      await this.cleanActionCache('findByAppIdInternal', [String(result.appId)]);
      // 清除 getPublicByAppId 缓存，确保群组添加机器人时能获取到最新的 allowGroup 设置
      await this.cleanActionCache('getPublicByAppId', [String(result.appId)]);
      
      // 如果更新的是命令列表，清除相关缓存
      if (fieldName === 'commands') {
        // 清除特定机器人的缓存
        await this.cleanActionCache('getBotCommands', [String(result.appId)]);
        await this.cleanActionCache('getBotCommandsByScope', [String(result.appId)]);
        
        // 清除所有范围类型的缓存
        const scopeTypes = ['default', 'all_private_chats', 'all_group_chats', 'chat', 'chat_member'];
        for (const scopeType of scopeTypes) {
          await this.cleanActionCache('getBotCommandsByScope', [String(result.appId), scopeType]);
        }
        
        // ✅ 获取/确保机器人用户ID，并回填到 app.userId，保证后续广播稳定
        let botUserId: string | undefined;
        try {
          const botId = 'open_' + result.appId;
          const botEmail = `${botId}@openapi.msgbyte.com`;
          let botUser = await this.adapter.model.db.collection('users').findOne({ email: botEmail });
          if (!botUser) {
            // 确保机器人用户存在（幂等）
            try {
              await this.waitForServices(['user']);
              await (ctx as any).call('user.ensureOpenapiBot', {
                botId,
                nickname: result.appName,
                avatar: result.appIcon,
                username: result.bot?.username,
              });
            } catch (e) {
              this.logger.warn(`[setAppBotInfo] ensureOpenapiBot failed for ${result.appId}:`, e);
            }
            // 再次查找
            botUser = await this.adapter.model.db.collection('users').findOne({ email: botEmail });
          }
          if (botUser && botUser._id) {
            botUserId = String(botUser._id);
            // 异步回填 app.userId（不阻塞主流程）
            this.adapter.model.updateOne({ appId: result.appId }, { $set: { userId: botUser._id } }).exec().catch(() => {});
          }
        } catch (error) {
          this.logger.warn(`[setAppBotInfo] Failed to get/ensure bot userId for ${result.appId}:`, error);
        }
        
        // 版本/etag 计算与持久化（基于最新 result.bot.commands）
        let nextVersion: number | null = null;
        let nextEtag: string | null = null;
        try {
          const prevVersion = (result as any)?.bot?.version || 0;
          nextVersion = prevVersion + 1;
          const serialized = JSON.stringify((result as any)?.bot?.commands || []);
          nextEtag = crypto.createHash('sha1').update(serialized).digest('hex');
          await this.adapter.model.updateOne(
            { _id: (result as any)._id },
            {
              $set: {
                'bot.version': nextVersion,
                'bot.etag': nextEtag,
                'bot.updatedAt': Date.now(),
              },
            }
          ).exec();
        } catch (e) {
          this.logger.warn('[setAppBotInfo] 计算或保存命令版本/etag 失败:', e);
        }

        // 已移除：命令更新推送
        this.logger.info(`[setAppBotInfo] 机器人 ${result.appId} 命令已更新，已清除缓存 (userId: ${botUserId})`);
      }
    }
  }


  /**
   * 获取机器人命令列表
   */
  async getBotCommands(ctx: TcContext<{ appId: string; scope?: string; ifVersion?: number; ifEtag?: string }>) {
    const { appId, scope, ifVersion, ifEtag } = ctx.params;

    // 查找应用信息
    const app = await this.adapter.model.findOne({ appId }).exec();
    
    if (!app) {
      throw new Error('Not found openapp');
    }

    // 检查应用是否启用了机器人功能
    if (!app.capability.includes('bot')) {
      throw new Error('Bot capability is not enabled for this app');
    }

    let commands = app.bot?.commands || [];
    
    // 如果指定了scope，进行筛选
    if (scope) {
      commands = commands.filter(cmd => {
        // 如果命令没有scope，默认为'default'
        const cmdScope = cmd.scope?.type || 'default';
        return cmdScope === scope;
      });
    }

    const version = (app as any)?.bot?.version || 0;
    const etag = (app as any)?.bot?.etag || null;
    if ((ifVersion !== undefined && ifVersion === version) || (ifEtag && etag && ifEtag === etag)) {
      return { appId: app.appId, notModified: true, version, etag };
    }

    // 返回机器人命令列表
    return {
      appId: app.appId,
      appName: app.appName,
      commands,
      version,
      etag,
    };
  }

  /**
   * 按范围获取机器人命令列表
   */
  async getBotCommandsByScope(ctx: TcContext<{ 
    appId: string; 
    scopeType: string;
    chatId?: string;
    userId?: string;
    ifVersion?: number;
    ifEtag?: string;
  }>) {
    const { appId, scopeType, chatId, userId, ifVersion, ifEtag } = ctx.params;

    // 查找应用信息
    const app = await this.adapter.model.findOne({ appId }).exec();
    
    if (!app) {
      throw new Error('Not found openapp');
    }

    // 检查应用是否启用了机器人功能
    if (!app.capability.includes('bot')) {
      throw new Error('Bot capability is not enabled for this app');
    }

    const commands = app.bot?.commands || [];
    
    // 根据范围类型筛选命令
    const filteredCommands = commands.filter(cmd => {
      const cmdScope = cmd.scope?.type || 'default';
      
      if (cmdScope !== scopeType) {
        return false;
      }
      
      // 对于特定聊天或成员的范围，需要匹配ID
      if (scopeType === 'chat' || scopeType === 'chat_member') {
        if (!cmd.scope?.chat_id || cmd.scope.chat_id !== chatId) {
          return false;
        }
      }
      
      if (scopeType === 'chat_member') {
        if (!cmd.scope?.user_id || cmd.scope.user_id !== userId) {
          return false;
        }
      }
      
      return true;
    });

    const version = (app as any)?.bot?.version || 0;
    const etag = (app as any)?.bot?.etag || null;
    if ((ifVersion !== undefined && ifVersion === version) || (ifEtag && etag && ifEtag === etag)) {
      return { appId: app.appId, notModified: true, version, etag };
    }

    return {
      appId: app.appId,
      appName: app.appName,
      scopeType,
      commands: filteredCommands,
      version,
      etag,
    };
  }

  /**
   * 获取机器人命令元数据（版本/etag）
   */
  async getBotCommandMeta(ctx: TcContext<{ appId: string }>) {
    const { appId } = ctx.params;
    const app = await this.adapter.model.findOne({ appId }).exec();
    if (!app) {
      throw new Error('Not found openapp');
    }
    return {
      appId: app.appId,
      version: (app as any)?.bot?.version || 0,
      etag: (app as any)?.bot?.etag || null,
      updatedAt: (app as any)?.bot?.updatedAt || null,
    };
  }

  /**
   * 按机器人用户ID列表获取命令（前端主导方案）
   * 前端已知机器人用户ID，直接传递给服务端获取命令
   */
  async getBotCommandsByUserIds(ctx: TcContext<{
    botUserIds: string[];
    converseId: string;
    groupId?: string;
    ifVersion?: number;
    ifEtag?: string;
  }>) {
    const { botUserIds, converseId, groupId, ifVersion, ifEtag } = ctx.params;
    const userId = ctx.meta.userId;

    if (!Array.isArray(botUserIds) || botUserIds.length === 0) {
      this.logger.warn(`[getBotCommandsByUserIds] 机器人用户ID列表为空`);
      return [];
    }
    if (botUserIds.length !== 1) {
      this.logger.warn(`[getBotCommandsByUserIds] 收到 ${botUserIds.length} 个botUserId，请按单个请求调用`);
      throw new Error('Only a single botUserId is allowed per request');
    }

    try {
      const botUsers: any[] = await ctx.call('user.getUserInfoList', { userIds: botUserIds });
      if (!botUsers || botUsers.length === 0) {
        this.logger.warn(`[getBotCommandsByUserIds] 找不到机器人用户信息: ${botUserIds.join(', ')}`);
        return [];
      }

      const result: any[] = [];
      for (const botUser of botUsers) {
        if (!botUser || botUser.type !== 'openapiBot') {
          this.logger.info(`[getBotCommandsByUserIds] 跳过非机器人用户: ${botUser?._id}`);
          continue;
        }
        try {
          const botEmail = botUser.email;
          if (!botEmail || !botEmail.startsWith('open_') || !botEmail.endsWith('@openapi.msgbyte.com')) {
            this.logger.info(`[getBotCommandsByUserIds] 机器人邮箱格式不正确: ${botEmail}`);
            continue;
          }
          const appId = botEmail.replace('open_', '').replace('@openapi.msgbyte.com', '');
          const app = await this.adapter.model.findOne({ appId }).exec();
          if (!app || !app.capability.includes('bot') || !app.bot?.commands?.length) {
            continue;
          }
          const filteredCommands = app.bot.commands.filter((cmd: any) => {
            const scope = cmd.scope;
            if (!scope || scope.type === 'default') return true;
            if (scope.type === 'all_private_chats') return !groupId;
            if (scope.type === 'all_group_chats') return !!groupId;
            if (scope.type === 'chat') return scope.chat_id === converseId;
            if (scope.type === 'chat_member') return scope.chat_id === converseId && scope.user_id === userId;
            return false;
          });
          if (filteredCommands.length > 0) {
            const version = (app as any)?.bot?.version || 0;
            const etag = (app as any)?.bot?.etag || null;
            if ((ifVersion !== undefined && ifVersion === version) || (ifEtag && etag && ifEtag === etag)) {
              result.push({ appId: app.appId, userId: String(botUser._id), notModified: true, version, etag } as any);
            } else {
              result.push({
                appId: app.appId,
                appName: app.appName,
                appIcon: app.appIcon,
                userId: String(botUser._id),
                commands: filteredCommands,
                version,
                etag,
              });
            }
          }
        } catch (error) {
          this.logger.warn(`[getBotCommandsByUserIds] 处理机器人 ${botUser?._id} 失败:`, error);
        }
      }
      this.logger.info(`[getBotCommandsByUserIds] 返回 ${result.length} 个机器人的命令`);
      return result;
    } catch (error) {
      this.logger.error(`[getBotCommandsByUserIds] 获取命令失败:`, error);
      throw error;
    }
  }

  /**
   * 清理获取开放平台应用的缓存
   */
  private async cleanAppInfoCache(appSecret: string) {
    await this.cleanActionCache('get', [String(appSecret)]);
  }
}

export default OpenAppService;

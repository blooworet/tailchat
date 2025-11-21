import { TcCacheCleaner } from '../../../mixins/cache.cleaner.mixin';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type {
  User,
  UserDocument,
  UserLoginRes,
  UserModel,
} from '../../../models/user/user';
import {
  TcService,
  TcDbService,
  TcContext,
  TcPureContext,
  UserJWTPayload,
  config,
  PureContext,
  Errors,
  DataNotFoundError,
  EntityError,
  db,
  call,
  BannedError,
  UserStructWithToken,
} from 'tailchat-server-sdk';
import {
  generateRandomNumStr,
  generateRandomStr,
  getEmailAddress,
  validateUsernameStrict,
  normalizeUsernameCandidateFromNickname,
  shortHash,
} from '../../../lib/utils';
import type { TFunction } from 'i18next';
import _ from 'lodash';
import type { UserStruct } from 'tailchat-server-sdk';

const { isValidObjectId, Types } = db;

/**
 * 用户服务
 */
interface UserService extends TcService, TcDbService<UserDocument, UserModel> {}
class UserService extends TcService {
  get serviceName() {
    return 'user';
  }

  onInit() {
    this.registerLocalDb(require('../../../models/user/user').default);
    this.registerMixin(TcCacheCleaner(['cache.clean.user']));

    // Public fields
    this.registerDbField([
      '_id',
      'username',
      'email',
      'nickname',
      'discriminator',
      'temporary',
      'avatar',
      'type',
      'emailVerified',
      'banned',
      'extra',
      'createdAt',
    ]);

    this.registerAction('login', this.login, {
      rest: 'POST /login',
      params: {
        username: 'string',
        password: 'string',
      },
    });
    this.registerAction('verifyEmail', this.verifyEmail, {
      params: {
        email: 'email',
      },
    });
    this.registerAction('verifyEmailWithOTP', this.verifyEmailWithOTP, {
      params: {
        emailOTP: 'string',
      },
    });
    this.registerAction('register', this.register, {
      rest: 'POST /register',
      params: {
        username: { type: 'string', optional: true, max: 40 },
        email: { type: 'email', optional: true, max: 40 },
        nickname: { type: 'string', optional: true, max: 40 },
        password: { type: 'string', max: 40 },
        emailOTP: { type: 'string', optional: true },
        avatar: { type: 'string', optional: true },
      },
    });
    this.registerAction('signUserToken', this.signUserToken, {
      visibility: 'public',
      params: {
        userId: 'string',
      },
    });
    this.registerAction('modifyPassword', this.modifyPassword, {
      rest: 'POST /modifyPassword',
      params: {
        oldPassword: 'string',
        newPassword: 'string',
      },
    });
    this.registerAction('createTemporaryUser', this.createTemporaryUser, {
      params: {
        nickname: 'string',
      },
    });
    this.registerAction('claimTemporaryUser', this.claimTemporaryUser, {
      params: {
        userId: 'string',
        username: { type: 'string', optional: true, max: 40 },
        email: { type: 'email', max: 40 },
        password: { type: 'string', max: 40 },
        emailOTP: { type: 'string', optional: true },
      },
    });
    this.registerAction('forgetPassword', this.forgetPassword, {
      rest: {
        method: 'POST',
      },
      params: {
        email: 'email',
      },
    });
    this.registerAction('resetPassword', this.resetPassword, {
      rest: {
        method: 'POST',
      },
      params: {
        email: 'email',
        password: 'string',
        otp: 'string',
      },
    });
    this.registerAction('resolveToken', this.resolveToken, {
      cache: {
        keys: ['token'],
        ttl: 60 * 60, // 1 hour
      },
      params: {
        token: 'string',
      },
    });
    this.registerAction('checkTokenValid', this.checkTokenValid, {
      cache: {
        keys: ['token'],
        ttl: 60 * 60, // 1 hour
      },
      params: {
        token: 'string',
      },
    });
    this.registerAction('extractTokenMeta', this.extractTokenMeta, {
      visibility: 'public',
      params: {
        token: { type: 'string', optional: true },
      },
    });
    this.registerAction('banUser', this.banUser, {
      params: {
        userId: 'string',
      },
      visibility: 'public',
    });
    this.registerAction('unbanUser', this.unbanUser, {
      params: {
        userId: 'string',
      },
      visibility: 'public',
    });
    this.registerAction('whoami', this.whoami);
    this.registerAction(
      'searchUserWithUniqueName',
      this.searchUserWithUniqueName,
      {
        params: {
          uniqueName: 'string',
        },
      }
    );
    // New username-exact search (case-insensitive)
    this.registerAction('findUserByUsernameCI', this.findUserByUsername, {
      visibility: 'published',
      // Register both lowercase and camelCase paths to avoid case pitfalls
      rest: ['POST /finduserbyusernameci', 'POST /findUserByUsernameCI'],
      params: {
        username: 'string',
      },
    });
    this.registerAction('getUserInfo', this.getUserInfo, {
      params: {
        userId: 'string',
      },
      cache: {
        keys: ['userId'],
        ttl: 6 * 60 * 60, // 6 hour
      },
    });
    this.registerAction('getUserInfoList', this.getUserInfoList, {
      params: {
        userIds: {
          type: 'array',
          items: 'string',
        },
      },
    });
    this.registerAction('findUserByEmail', this.findUserByEmail, {
      visibility: 'published',
      params: {
        email: 'string',
      },
    });
    this.registerAction('findUserByUsername', this.findUserByUsername, {
      visibility: 'published',
      params: {
        username: 'string',
      },
    });
    
    // 添加公开查询用户信息接口 (无需登录)
    this.registerAction('findPublicUser', this.findPublicUser, {
      visibility: 'published',
      disableSocket: true,
      rest: {
        method: 'GET',
        path: '/public/:username',
      },
      params: {
        username: 'string',
      },
    });
    this.registerAction('getBotPublicInfo', this.getBotPublicInfo, {
      visibility: 'published',
      params: {
        botUserId: 'string',
      },
    });
    this.registerAction('updateUserField', this.updateUserField, {
      params: {
        fieldName: 'string',
        fieldValue: 'any',
      },
    });
    this.registerAction('updateUserExtra', this.updateUserExtra, {
      params: {
        fieldName: 'string',
        fieldValue: 'any',
      },
    });
    this.registerAction('getUserSettings', this.getUserSettings);
    this.registerAction('setUserSettings', this.setUserSettings, {
      params: {
        settings: 'object',
      },
    });
    this.registerAction('blockBot', this.blockBot, {
      params: {
        botUserId: 'string',
      },
    });
    this.registerAction('unblockBot', this.unblockBot, {
      params: {
        botUserId: 'string',
      },
    });
    this.registerAction('isBotBlocked', this.isBotBlocked, {
      params: {
        botUserId: 'string',
      },
      visibility: 'published',
    });
    this.registerAction('reportBot', this.reportBot, {
      params: {
        botUserId: 'string',
        reason: 'string',
        details: { type: 'string', optional: true },
      },
    });
    this.registerAction('ensurePluginBot', this.ensurePluginBot, {
      params: {
        /**
         * 用户名唯一id, 创建的用户邮箱会为 <botId>@tailchat-plugin.com
         */
        botId: 'string',
        nickname: 'string',
        avatar: { type: 'string', optional: true },
        username: { type: 'string', optional: true },
      },
    });
    this.registerAction('findOpenapiBotId', this.findOpenapiBotId, {
      params: {
        email: 'string',
      },
    });
    this.registerAction('ensureOpenapiBot', this.ensureOpenapiBot, {
      params: {
        /**
         * 用户名唯一id, 创建的用户邮箱会为 <botId>@tailchat-open.com
         */
        botId: 'string',
        nickname: 'string',
        avatar: { type: 'string', optional: true },
        username: { type: 'string', optional: true },
      },
    });
    this.registerAction('deleteOpenapiBot', this.deleteOpenapiBot, {
      params: {
        botEmail: 'string',
      },
    });
    this.registerAction('generateUserToken', this.generateUserToken, {
      visibility: 'published',
      params: {
        userId: 'string',
        nickname: 'string',
        email: 'string',
        avatar: 'string',
      },
    });
    
    // 添加管理员检查方法
    this.registerAction('isAdmin', this.isAdmin, {
      params: {
        userId: 'string',
      },
      visibility: 'published',
    });
    
    // 添加更新机器人用户名方法
    this.registerAction('updateBotUsername', this.updateBotUsername, {
      params: {
        userId: 'string',
        username: { type: 'string', optional: true },
      },
    });

    // 添加根据用户名查找机器人的方法
    this.registerAction('findBotByUsername', this.findBotByUsername, {
      params: {
        username: 'string',
      },
    });

    this.registerAuthWhitelist([
      '/verifyEmail',
      '/forgetPassword',
      '/resetPassword',
      '/public/:username',
    ]);

    // 迁移任务改至 onStart，确保 adapter/model 已初始化
  }

  protected async onStart() {
    // 自动化、无感知迁移：确保 usernameLower 与唯一索引
    // 在服务启动阶段运行一次，幂等且可安全并发
    this.ensureUsernameUniqueInfrastructure().catch((err) => {
      this.logger.error('ensureUsernameUniqueInfrastructure failed:', err);
    });
    // 自动化、无感知迁移：为机器人补齐/规范 username（必须以 bot 结尾）并确保唯一
    this.ensureBotUsernameComplianceInfrastructure().catch((err) => {
      this.logger.error('ensureBotUsernameComplianceInfrastructure failed:', err);
    });
  }

  /**
   * jwt秘钥
   */
  get jwtSecretKey() {
    return config.secret;
  }

  /**
   * 生成hash密码
   */
  hashPassword = async (password: string): Promise<string> =>
    bcrypt.hash(password, 10);
  /**
   * 对比hash密码是否正确
   */
  comparePassword = async (password: string, hash: string): Promise<boolean> =>
    bcrypt.compare(password, hash);

  /**
   * 用户登录
   * 登录可以使用用户名登录或者邮箱登录
   */
  async login(
    ctx: PureContext<
      { username: string; password: string },
      any
    >
  ): Promise<UserLoginRes> {
    const { username, password } = ctx.params;
    const { t } = ctx.meta;

    let user: UserDocument;
    user = await this.adapter.findOne({ usernameLower: username.toLowerCase() });
    if (!user) {
      throw new EntityError(t('用户不存在, 请检查您的用户名'), 442, '', [
        { field: 'username', message: t('用户名不存在') },
      ]);
    }

    const res = await this.comparePassword(password, user.password);
    if (!res) {
      throw new EntityError(t('密码错误'), 422, '', [
        { field: 'password', message: t('密码错误') },
      ]);
    }

    if (user.banned === true) {
      throw new BannedError(t('用户被封禁'), 403);
    }

    // Transform user entity (remove password and all protected fields)
    const doc = await this.transformDocuments(ctx, {}, user);
    return await this.transformEntity(doc, true, ctx.meta.token);
  }

  /**
   * 验证用户邮箱, 会往邮箱发送一个 OTP 作为唯一标识
   * 需要在注册的时候带上
   */
  async verifyEmail(ctx: TcPureContext<{ email: string }>) {
    const email = ctx.params.email;
    const t = ctx.meta.t;
    const cacheKey = this.buildVerifyEmailKey(email);

    const c = await this.broker.cacher.get(cacheKey);
    if (!!c) {
      // 如果有一个忘记密码请求未到期
      throw new Error(t('过于频繁的请求，10 分钟内可以共用同一OTP'));
    }

    const otp = generateRandomNumStr(6); // 产生一次性6位数字密码

    const html = `
    <p>您正在尝试验证 Tailchat 账号的邮箱, 请使用以下 OTP 作为邮箱验证凭证:</p>
    <h3>OTP: <strong>${otp}</strong></h3>
    <p>该 OTP 将会在 10分钟 后过期</p>
    <p style="color: grey;">如果并不是您触发的验证操作，请忽略此电子邮件。</p>`;

    await ctx.call('mail.sendMail', {
      to: email,
      subject: `Tailchat 邮箱验证: ${otp}`,
      html,
    });

    await this.broker.cacher.set(cacheKey, otp, 10 * 60); // 记录该OTP ttl: 10分钟

    return true;
  }

  /**
   * 通过用户邮件验证OTP, 并更新用户验证状态
   */
  async verifyEmailWithOTP(ctx: TcContext<{ emailOTP: string }>) {
    const emailOTP = ctx.params.emailOTP;
    const userId = ctx.meta.userId;
    const t = ctx.meta.t;

    const userInfo = await call(ctx).getUserInfo(userId);
    if (userInfo.emailVerified === true) {
      throw new Error(t('邮箱已认证'));
    }

    // 检查
    const cacheKey = this.buildVerifyEmailKey(userInfo.email);
    const cachedOTP = await this.broker.cacher.get(cacheKey);
    if (!cachedOTP) {
      throw new Error(t('校验失败, OTP已过期'));
    }
    if (String(cachedOTP) !== emailOTP) {
      throw new Error(t('邮箱校验失败, 请输入正确的邮箱OTP'));
    }

    // 验证通过
    const user = await this.adapter.model.findOneAndUpdate(
      {
        _id: new Types.ObjectId(userId),
      },
      {
        emailVerified: true,
      },
      {
        new: true,
      }
    );

    await this.cleanCurrentUserCache(ctx);

    return this.transformDocuments(ctx, {}, user);
  }

  /**
   * 用户注册
   */
  async register(
    ctx: TcPureContext<
      {
        username?: string;
        email?: string;
        nickname?: string;
        password: string;
        emailOTP?: string;
        avatar?: string;
      },
      any
    >
  ): Promise<UserStructWithToken> {
    const params = { ...ctx.params };
    const t = ctx.meta.t;
    await this.validateEntity(params);

    await this.validateRegisterParams(params, t);

    if (config.feature.disableUserRegister) {
      throw new Error(t('服务器不允许新用户注册'));
    }

    const nickname =
      params.nickname || (params.username ?? getEmailAddress(params.email));
    const discriminator = await this.adapter.model.generateDiscriminator(
      nickname
    );

    let emailVerified = false;
    if (config.emailVerification === true) {
      // 检查OTP
      const cacheKey = this.buildVerifyEmailKey(params.email);
      const cachedOTP = await this.broker.cacher.get(cacheKey);

      if (!cachedOTP) {
        throw new Error(t('校验失败, OTP已过期'));
      }

      if (String(cachedOTP) !== params.emailOTP) {
        throw new Error(t('邮箱校验失败, 请输入正确的邮箱OTP'));
      }

      emailVerified = true;
    }

    // Generate username from nickname/email if not provided
    if (!params.username) {
      const base = normalizeUsernameCandidateFromNickname(nickname) || getEmailAddress(params.email);
      params.username = base;
    }

    // Check if username already exists (no auto-allocation)
    if (params.username) {
      const existingUser = await this.adapter.model.findOne({
        usernameLower: params.username.toLowerCase(),
      });
      if (existingUser) {
        throw new Errors.MoleculerClientError(t('用户名已存在，请选择其他用户名'), 422, '', [
          { field: 'username', message: 'already exists' },
        ]);
      }
    }

    const password = await this.hashPassword(params.password);
    const doc = await this.adapter.insert({
      ...params,
      username: params.username,
      usernameLower: params.username ? params.username.toLowerCase() : undefined,
      password,
      nickname,
      discriminator,
      emailVerified,
      createdAt: new Date(),
    });
    const user = await this.transformDocuments(ctx, {}, doc);
    const json = await this.transformEntity(user, true, ctx.meta.token);
    await this.entityChanged('created', json, ctx);
    return json;
  }

  /**
   * 签发token
   * 仅内部可以调用
   */
  async signUserToken(
    ctx: TcContext<{
      userId: string;
    }>
  ): Promise<string> {
    const userId = ctx.params.userId;

    const userInfo = await call(ctx).getUserInfo(userId);
    const token = this.generateJWT({
      _id: userInfo._id,
      nickname: userInfo.nickname,
      email: userInfo.email,
      avatar: userInfo.avatar,
    });

    return token;
  }

  /**
   * 修改密码
   */
  async modifyPassword(
    ctx: TcContext<{
      oldPassword: string;
      newPassword: string;
    }>
  ) {
    const { oldPassword, newPassword } = ctx.params;
    const { userId, t } = ctx.meta;

    const user = await this.adapter.model.findById(userId);
    if (!user) {
      throw new Error(t('用户不存在'));
    }

    const oldPasswordMatched = await this.comparePassword(
      oldPassword,
      user.password
    );
    if (!oldPasswordMatched) {
      throw new Error(t('密码不正确'));
    }

    user.password = await this.hashPassword(newPassword);
    await user.save();

    return true;
  }

  /**
   * 创建临时用户
   */
  async createTemporaryUser(ctx: TcPureContext<{ nickname: string }>) {
    const nickname = ctx.params.nickname;
    const t = ctx.meta.t;

    if (config.feature.disableGuestLogin) {
      throw new Error(t('服务器不允许游客登录'));
    }

    const discriminator = await this.adapter.model.generateDiscriminator(
      nickname
    );

    const password = await this.hashPassword(generateRandomStr());
    const doc = await this.adapter.insert({
      email: `${generateRandomStr()}@temporary.msgbyte.com`,
      password,
      nickname,
      discriminator,
      temporary: true,
      avatar: null,
      createdAt: new Date(),
    });
    const user = await this.transformDocuments(ctx, {}, doc);
    const json = await this.transformEntity(user, true);
    await this.entityChanged('created', json, ctx);

    return json;
  }

  /**
   * 认领临时用户
   */
  async claimTemporaryUser(
    ctx: TcPureContext<{
      userId: string;
      username?: string;
      email: string;
      password: string;
      emailOTP?: string;
    }>
  ) {
    const params = ctx.params;
    const t = ctx.meta.t;

    const user = await this.adapter.findById(params.userId);
    if (!user) {
      throw new DataNotFoundError(t('认领用户不存在'));
    }
    if (!user.temporary) {
      throw new Error(t('该用户不是临时用户'));
    }

    if (config.emailVerification === true) {
      // 检查OTP
      const cacheKey = this.buildVerifyEmailKey(params.email);
      const cachedOTP = await this.broker.cacher.get(cacheKey);

      if (!cachedOTP) {
        throw new Error(t('校验失败, OTP已过期'));
      }

      if (String(cachedOTP) !== params.emailOTP) {
        throw new Error(t('邮箱校验失败, 请输入正确的邮箱OTP'));
      }

      user.emailVerified = true;
    }

    await this.validateRegisterParams(params, t);
    const password = await this.hashPassword(params.password);

    if (!params.username) {
      const base = normalizeUsernameCandidateFromNickname(user.nickname) || getEmailAddress(params.email);
      params.username = await this.allocateUsername(base, { isBot: false });
    }

    user.username = params.username;
    user.usernameLower = params.username ? params.username.toLowerCase() : undefined;
    user.email = params.email;
    user.password = password;
    user.temporary = false;
    await user.save();

    const json = await this.transformEntity(user, true);
    await this.entityChanged('updated', json, ctx);
    return json;
  }

  /**
   * 忘记密码
   *
   * 流程: 发送一个链接到远程，点开后可以直接重置密码
   */
  async forgetPassword(
    ctx: TcPureContext<{
      email: string;
    }>
  ) {
    const { email } = ctx.params;
    const { t } = ctx.meta;
    const cacheKey = `forget-password:${email}`;

    const c = await this.broker.cacher.get(cacheKey);
    if (!!c) {
      // 如果有一个忘记密码请求未到期
      throw new Error(t('过于频繁的请求，10 分钟内可以共用同一OTP'));
    }

    const otp = generateRandomNumStr(6); // 产生一次性6位数字密码

    const html = `
    <p>忘记密码了？ 请使用以下 OTP 作为重置密码凭证:</p>
    <h3>OTP: <strong>${otp}</strong></h3>
    <p>该 OTP 将会在 10分钟 后过期</p>
    <p style="color: grey;">如果并不是您触发的忘记密码操作，请忽略此电子邮件。</p>`;

    await ctx.call('mail.sendMail', {
      to: email,
      subject: `Tailchat 忘记密码: ${otp}`,
      html,
    });

    await this.broker.cacher.set(cacheKey, otp, 10 * 60); // 记录该OTP ttl: 10分钟

    return true;
  }

  /**
   * 重置密码
   */
  async resetPassword(
    ctx: TcPureContext<{
      email: string;
      password: string;
      otp: string;
    }>
  ) {
    const { email, password, otp } = ctx.params;
    const { t } = ctx.meta;
    const cacheKey = `forget-password:${email}`;

    const cachedOTP = await this.broker.cacher.get(cacheKey);

    if (!cachedOTP) {
      throw new Error(t('校验失败, OTP已过期'));
    }

    if (String(cachedOTP) !== otp) {
      throw new Error(t('OTP 不正确'));
    }

    const res = await this.adapter.model.updateOne(
      {
        email,
      },
      {
        password: await this.hashPassword(password),
      }
    );

    if (res.modifiedCount === 0) {
      throw new Error(t('账号不存在'));
    }

    await this.broker.cacher.clean(cacheKey);

    return true;
  }

  /**
   * 校验JWT的合法性
   * @param ctx
   * @returns
   */
  async resolveToken(ctx: PureContext<{ token: string }, any>) {
    const decoded = await this.verifyJWT(ctx.params.token);
    const t = ctx.meta.t;

    if (typeof decoded._id !== 'string') {
      // token 中没有 _id
      throw new EntityError(t('Token 内容不正确'));
    }
    const doc = await this.adapter.model.findById(decoded._id);
    const user: User = await this.transformDocuments(ctx, {}, doc);

    // 检查用户是否存在
    if (!user) {
      throw new EntityError(t('用户不存在或已被删除'));
    }


    if (user.banned === true) {
      throw new BannedError(t('用户被封禁'));
    }

    const json = await this.transformEntity(user, true, ctx.params.token);
    return json;
  }

  /**
   * 检查授权是否可用
   */
  async checkTokenValid(ctx: PureContext<{ token: string }>) {
    try {
      await this.verifyJWT(ctx.params.token);

      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 提取 token 元信息（含 btid），用于上游做 scope 判定
   */
  async extractTokenMeta(ctx: PureContext<{ token?: string }>) {
    // 如果 token 为空（使用 X-App-Secret 认证时），返回 null
    if (!ctx.params.token) {
      return null;
    }
    const decoded = await this.verifyJWT(ctx.params.token);
    return decoded;
  }

  /**
   * 封禁用户
   */
  async banUser(
    ctx: TcContext<{
      userId: string;
    }>
  ) {
    const { userId } = ctx.params;
    await this.adapter.model.updateOne(
      {
        _id: userId,
      },
      {
        banned: true,
      }
    );

    await this.cleanUserInfoCache(userId);
    const tokens = await ctx.call('gateway.getUserSocketToken', {
      userId,
    });
    if (Array.isArray(tokens)) {
      await Promise.all(
        tokens.map((token) => this.cleanActionCache('resolveToken', [token]))
      );
    }

    await ctx.call('gateway.tickUser', {
      userId,
    });
  }

  /**
   * 解除封禁用户
   */
  async unbanUser(
    ctx: TcContext<{
      userId: string;
    }>
  ) {
    const { userId } = ctx.params;
    await this.adapter.model.updateOne(
      {
        _id: userId,
      },
      {
        banned: false,
      }
    );

    this.cleanUserInfoCache(userId);
    const tokens = await ctx.call('gateway.getUserSocketToken', {
      userId,
    });
    if (Array.isArray(tokens)) {
      tokens.map((token) => this.cleanActionCache('resolveToken', [token]));
    }
  }

  async whoami(ctx: TcContext) {
    return ctx.meta ?? null;
  }

  /**
   * 搜索用户
   *
   */
  async searchUserWithUniqueName(ctx: TcContext<{ uniqueName: string }>) {
    const t = ctx.meta.t;
    const uniqueName = ctx.params.uniqueName;
    // 收口：彻底禁用旧接口
    this.logger.warn('Deprecated API blocked: user.searchUserWithUniqueName', {
      uniqueName,
    });
    throw new EntityError(t('该接口已下线，请按用户名搜索（不含#）'));
  }

  /**
   * 公开查询用户信息
   */
  async findPublicUser(ctx: TcContext<{ username: string }>) {
    const rawUsername = String(ctx.params.username || '').trim();
    const t = ctx.meta.t;

    if (!rawUsername) {
      throw new DataNotFoundError(t('用户不存在'));
    }

    const usernameLower = rawUsername.toLowerCase();
    const cacheKey = this.buildPublicUserCacheKey(usernameLower);
    const cacher = this.broker.cacher;

    if (cacher) {
      const cached = await cacher.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const doc = await this.adapter.model
      .findOne(
        { usernameLower },
        {
          username: 1,
          nickname: 1,
        }
      )
      .lean();

    if (!doc) {
      throw new DataNotFoundError(t('用户不存在'));
    }

    const publicInfo = {
      _id: String((doc as any)._id),
      username: doc.username ?? '',
      nickname: doc.nickname ?? '',
    };

    if (cacher) {
      await cacher.set(cacheKey, publicInfo, 3);
    }

    return publicInfo;
  }


  /**
   * 自动迁移：为存量用户补充 username / usernameLower，并创建唯一索引
   * 幂等执行：若索引已存在则快速返回
   */
  private async ensureUsernameUniqueInfrastructure() {
    const col = this.adapter.model.collection;
    // 1) 如果唯一索引已存在，直接返回
    const indexes = await col.indexes();
    const hasUnique = indexes.some(
      (i: any) => i.key && i.key.usernameLower && i.unique === true
    );
    if (hasUnique) {
      return;
    }

    // 2) 预热已占用集合
    const taken = new Set<string>();
    const existing = await col
      .find({ usernameLower: { $type: 'string' } }, { projection: { usernameLower: 1 } })
      .toArray();
    existing.forEach((d: any) => d.usernameLower && taken.add(d.usernameLower));

    // 分批游标扫描（排除机器人用户，机器人用户由专门的方法处理）
    const cursor = col.find({ type: { $nin: ['pluginBot', 'openapiBot'] } }, { projection: { _id: 1, username: 1, usernameLower: 1, nickname: 1 } });
    const isValid = (name?: string) => validateUsernameStrict(name ?? '', { isBot: false });
    const allocate = (base: string, id: any): string => {
      let candidate = base;
      let i = 0;
      while (i < 100 && (taken.has(candidate.toLowerCase()) || !isValid(candidate))) {
        i += 1;
        candidate = `${base}_${i}`;
      }
      if (taken.has(candidate.toLowerCase()) || !isValid(candidate)) {
        candidate = `${base}_${shortHash(String(id), 4)}`;
      }
      taken.add(candidate.toLowerCase());
      return candidate;
    };

    const batch: any[] = [];
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) break;

      if (typeof doc.username === 'string' && isValid(doc.username)) {
        const lower = doc.username.toLowerCase();
        if (doc.usernameLower !== lower) {
          batch.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { usernameLower: lower } } } });
          taken.add(lower);
        }
        if (batch.length >= 500) {
          await col.bulkWrite(batch, { ordered: false });
          batch.length = 0;
        }
        continue;
      }

      const base = normalizeUsernameCandidateFromNickname(doc.nickname) || `user_${shortHash(String(doc._id), 4)}`;
      const allocated = allocate(base, doc._id);
      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { username: allocated, usernameLower: allocated.toLowerCase() } },
        },
      });
      if (batch.length >= 500) {
        await col.bulkWrite(batch, { ordered: false });
        batch.length = 0;
      }
    }
    if (batch.length > 0) {
      await col.bulkWrite(batch, { ordered: false });
    }

    // 3) 创建唯一索引（若并发创建会抛错，捕获忽略）
    try {
      await col.createIndex({ usernameLower: 1 }, { unique: true, name: 'usernameLower_unique' });
    } catch (e) {
      // ignore if already created concurrently
    }
  }

  /**
   * 自动迁移：为机器人账号补齐/规范 username（必须以 bot 结尾）与 usernameLower，确保唯一
   * 幂等执行：按实际差异更新
   */
  private async ensureBotUsernameComplianceInfrastructure() {
    const col = this.adapter.model.collection;
    const toLower = (s: string) => s.toLowerCase();
    const isValidBot = (name?: string) => validateUsernameStrict(name ?? '', { isBot: true });

    // 预热占用集合
    const taken = new Set<string>();
    const existing = await col
      .find({ usernameLower: { $type: 'string' } }, { projection: { usernameLower: 1 } })
      .toArray();
    existing.forEach((d: any) => d.usernameLower && taken.add(String(d.usernameLower)));

    const sanitize = (raw: string) => {
      const s = String(raw || '');
      let out = '';
      for (const ch of s) {
        if ((/^[A-Za-z0-9_]$/ as any).test ? (/^[A-Za-z0-9_]$/ as any).test(ch) : /[A-Za-z0-9_]/.test(ch)) {
          out += ch;
        }
      }
      out = out.replace(/^_+/, '').replace(/_+$/, '');
      if (out.length === 0) out = 'bot';
      if (out.length > 32) out = out.slice(0, 32);
      return out;
    };
    const ensureBotSuffix = (base: string) => (toLower(base).endsWith('bot') ? base : `${base}bot`);
    const withinLen = (name: string) => (name.length < 5 ? name.padEnd(5, '0') : name.length > 32 ? name.slice(0, 32) : name);
    const shortHashLocal = (s: string, n = 6) => shortHash(String(s), n);

    const allocate = (base: string, id: any): string => {
      const seed = withinLen(ensureBotSuffix(sanitize(base)));
      let candidate = seed;
      let i = 0;
      while (i < 100) {
        const lower = toLower(candidate);
        if (isValidBot(candidate) && !taken.has(lower)) {
          taken.add(lower);
          return candidate;
        }
        i += 1;
        // 将序号插入到 bot 后缀前，保持以 bot 结尾
        const insert = `_${i}`;
        const withoutSuffix = seed.replace(/bot$/i, '');
        candidate = withinLen(`${withoutSuffix}${insert}bot`);
      }
      const withoutSuffix = seed.replace(/bot$/i, '');
      const fallback = withinLen(`${withoutSuffix}_${shortHashLocal(String(id), 4)}bot`);
      taken.add(toLower(fallback));
      return fallback;
    };

    const cursor = col.find(
      { type: { $in: ['pluginBot', 'openapiBot'] } },
      { projection: { _id: 1, username: 1, usernameLower: 1, nickname: 1 } }
    );

    const batch: any[] = [];
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) break;

      // 如果已经有用户名，无论是否符合规范，都保留并只更新 usernameLower 字段
      if (typeof doc.username === 'string') {
        const lower = toLower(doc.username);
        if (doc.usernameLower !== lower) {
          batch.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { usernameLower: lower } } } });
        }
        if (batch.length >= 500) {
          await col.bulkWrite(batch, { ordered: false });
          batch.length = 0;
        }
        continue;
      }

      // 只为没有用户名的机器人分配新用户名
      const base = doc.nickname || `bot_${shortHashLocal(String(doc._id), 4)}`;
      const allocated = allocate(base, doc._id);
      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { username: allocated, usernameLower: toLower(allocated) } },
        },
      });
      if (batch.length >= 500) {
        await col.bulkWrite(batch, { ordered: false });
        batch.length = 0;
      }
    }
    if (batch.length > 0) {
      await col.bulkWrite(batch, { ordered: false });
    }
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(ctx: PureContext<{ userId: string }>) {
    const userId = ctx.params.userId;

    const doc = await this.adapter.findById(userId);
    const user = await this.transformDocuments(ctx, {}, doc);

    return user;
  }

  /**
   * 获取用户信息的批量操作版
   * 用于优化网络访问性能
   */
  async getUserInfoList(ctx: PureContext<{ userIds: string[] }>) {
    const userIds = ctx.params.userIds;

    if (userIds.some((userId) => !isValidObjectId(userId))) {
      throw new EntityError('Include invalid userId');
    }
    const list = await Promise.all(
      userIds.map((userId) =>
        ctx.call('user.getUserInfo', {
          userId,
        })
      )
    );

    return list;
  }

  /**
   * 通过用户邮箱查找用户
   */
  async findUserByEmail(
    ctx: TcContext<{
      email: string;
    }>
  ): Promise<UserStruct | null> {
    const email = ctx.params.email;

    const doc = await this.adapter.model.findOne({
      email,
    });

    if (!doc) {
      return null;
    }

    const user = await this.transformDocuments(ctx, {}, doc);

    return user;
  }

  /**
   * 通过用户邮箱查找用户
   */
  async findUserByUsername(
    ctx: TcContext<{
      username: string;
    }>
  ): Promise<UserStruct | null> {
    const username = ctx.params.username;

    const doc = await this.adapter.model.findOne({
      usernameLower: username.toLowerCase(),
    });

    if (!doc) {
      return null;
    }

    const user = await this.transformDocuments(ctx, {}, doc);

    return user;
  }

  /**
   * 获取机器人公开信息（最小公开字段）
   */
  async getBotPublicInfo(ctx: TcContext<{ botUserId: string }>) {
    const { botUserId } = ctx.params;
    const doc = await this.adapter.model.findById(botUserId);
    if (!doc) return null;
    const user = await this.transformDocuments(ctx, {}, doc);
    if (user?.type !== 'pluginBot' && user?.type !== 'openapiBot') {
      return null;
    }
    return {
      _id: String(user._id),
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      type: user.type,
    };
  }

  /**
   * 修改用户字段
   */
  async updateUserField(
    ctx: TcContext<{ fieldName: string; fieldValue: string }>
  ) {
    const { fieldName, fieldValue } = ctx.params;
    const t = ctx.meta.t;
    const userId = ctx.meta.userId;
    if (!['nickname', 'avatar'].includes(fieldName)) {
      // 只允许修改以上字段
      throw new EntityError(`${t('该数据不允许修改')}: ${fieldName}`);
    }

    const doc = await this.adapter.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(userId),
        },
        {
          [fieldName]: fieldValue,
        },
        {
          new: true,
        }
      )
      .exec();

    this.cleanCurrentUserCache(ctx);

    return await this.transformDocuments(ctx, {}, doc);
  }

  /**
   * 修改用户额外数据
   */
  async updateUserExtra(
    ctx: TcContext<{ fieldName: string; fieldValue: string }>
  ) {
    const { fieldName, fieldValue } = ctx.params;
    const userId = ctx.meta.userId;

    const doc = await this.adapter.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(userId),
        },
        {
          [`extra.${fieldName}`]: fieldValue,
        },
        {
          new: true,
        }
      )
      .exec();

    this.cleanCurrentUserCache(ctx);

    return await this.transformDocuments(ctx, {}, doc);
  }

  /**
   * 获取用户个人配置
   */
  async getUserSettings(ctx: TcContext<{}>) {
    const { userId } = ctx.meta as any;
    // 游客或未登录：返回空设置，避免前端初始化期间抛错
    if (!userId || !isValidObjectId(userId)) {
      return {};
    }

    const user: UserDocument | null = await this.adapter.model.findOne(
      { _id: new Types.ObjectId(userId) },
      { settings: 1 }
    );

    return (user && (user as any).settings) ? (user as any).settings : {};
  }

  /**
   * 设置用户个人配置
   */
  async setUserSettings(ctx: TcContext<{ settings: object }>) {
    const { settings } = ctx.params;
    const { userId } = ctx.meta;

    const user: UserDocument = await this.adapter.model.findOneAndUpdate(
      {
        _id: new Types.ObjectId(userId),
      },
      {
        $set: {
          ..._.mapKeys(settings, (value, key) => `settings.${key}`),
        },
      },
      { new: true }
    );

    if (!user) {
      throw new Error(ctx.meta.t('User not found'));
    }

    return user.settings;
  }

  /**
   * 屏蔽机器人（私信拦截）
   */
  async blockBot(ctx: TcContext<{ botUserId: string }>) {
    const userId = ctx.meta.userId;
    const botUserId = ctx.params.botUserId;
    const model = require('../../../models/user/botblock').default;
    const { Types } = require('mongoose');
    
    // 将字符串转换为 ObjectId 以匹配模型定义
    await model.updateOne(
      { 
        userId: new Types.ObjectId(userId), 
        botUserId: new Types.ObjectId(botUserId) 
      },
      { 
        $set: { 
          userId: new Types.ObjectId(userId), 
          botUserId: new Types.ObjectId(botUserId) 
        } 
      },
      { upsert: true }
    );
    return true;
  }

  /**
   * 解除屏蔽机器人
   */
  async unblockBot(ctx: TcContext<{ botUserId: string }>) {
    const userId = ctx.meta.userId;
    const botUserId = ctx.params.botUserId;
    const model = require('../../../models/user/botblock').default;
    const { Types } = require('mongoose');
    
    // 将字符串转换为 ObjectId 以匹配模型定义
    await model.deleteOne({ 
      userId: new Types.ObjectId(userId), 
      botUserId: new Types.ObjectId(botUserId) 
    });
    return true;
  }

  /**
   * 查询是否屏蔽机器人
   */
  async isBotBlocked(ctx: TcContext<{ botUserId: string }>) {
    const userId = ctx.meta.userId;
    const botUserId = ctx.params.botUserId;
    const model = require('../../../models/user/botblock').default;
    const { Types } = require('mongoose');
    
    // 将字符串转换为 ObjectId 以匹配模型定义
    const rec = await model.findOne({ 
      userId: new Types.ObjectId(userId), 
      botUserId: new Types.ObjectId(botUserId) 
    }).lean().exec();
    return Boolean(rec);
  }

  /**
   * 举报机器人
   */
  async reportBot(ctx: TcContext<{ botUserId: string; reason: string; details?: string }>) {
    const userId = ctx.meta.userId;
    const { botUserId, reason, details } = ctx.params;
    const model = require('../../../models/user/botreport').default;
    const rec = await model.create({ userId, botUserId, reason, details });
    try {
      ctx.emit('audit.bot.report', {
        userId,
        botUserId,
        reason,
        details,
        reportId: String(rec._id),
        timestamp: Date.now(),
      });
    } catch (e) {}
    return { reportId: String(rec._id) };
  }
  
  /**
   * 检查用户是否为系统管理员
   * 目前基于环境变量配置的管理员账号来判断
   */
  async isAdmin(ctx: TcContext<{ userId: string }>) {
    const { userId } = ctx.params;
    
    try {
      // 1. 检查是否配置了管理员环境变量
      const adminUsername = process.env.ADMIN_USER;
      if (!adminUsername) {
        this.logger.warn('isAdmin check failed: ADMIN_USER env not set');
        return false;
      }
      
      // 2. 获取用户信息
      const userInfo = await this.adapter.model.findById(userId).lean().exec();
      if (!userInfo) {
        return false;
      }
      
      // 3. 判断用户是否为管理员账号
      // 可以根据需要增加其他管理员判断逻辑
      if (userInfo.email === adminUsername || 
          userInfo.username === adminUsername) {
        return true;
      }
      
      return false;
    } catch (e) {
      this.logger.error('Error in isAdmin check:', e);
      return false;
    }
  }

  async ensurePluginBot(
    ctx: TcContext<{
      botId: string;
      nickname: string;
      avatar: string;
      username?: string;
    }>
  ): Promise<string> {
    const { botId, nickname, avatar } = ctx.params;
    const email = this.buildPluginBotEmail(botId);

    const bot = await this.adapter.model.findOne({
      email,
    });

    if (bot) {
      if (bot.nickname !== nickname || bot.avatar !== avatar) {
        /**
         * 如果信息不匹配，则更新
         */
        this.logger.info('检查到插件机器人信息不匹配, 更新机器人信息:', {
          nickname,
          avatar,
        });
        await bot.updateOne({
          nickname,
          avatar,
        });
        await this.cleanUserInfoCache(String(bot._id));
      }

      // 如果传入了 username，且当前机器人未设置或不一致，尝试设置
      if (typeof ctx.params.username === 'string') {
        const desired = ctx.params.username;
        if (validateUsernameStrict(desired, { isBot: true })) {
          const lower = desired.toLowerCase();
          const exists = await this.adapter.model.exists({ usernameLower: lower, _id: { $ne: bot._id } });
          if (!exists) {
            if (bot.username !== desired || bot.usernameLower !== lower) {
              await bot.updateOne({ username: desired, usernameLower: lower });
              await this.cleanUserInfoCache(String(bot._id));
            }
          }
        }
      }

      return String(bot._id);
    }

    // 如果不存在，则创建
    const doc: any = {
      email,
      nickname,
      avatar,
      type: 'pluginBot',
    };
    // 可选写入 username（需严格校验与唯一）
    if (typeof ctx.params.username === 'string') {
      const desired = ctx.params.username;
      if (validateUsernameStrict(desired, { isBot: true })) {
        const lower = desired.toLowerCase();
        const exists = await this.adapter.model.exists({ usernameLower: lower });
        if (!exists) {
          doc.username = desired;
          doc.usernameLower = lower;
        }
      }
    }

    const newBot = await this.adapter.model.create(doc);

    return String(newBot._id);
  }

  /**
   * 确保第三方开放平台机器人存在
   */
  async ensureOpenapiBot(
    ctx: TcContext<{
      botId: string;
      nickname: string;
      avatar: string;
      username?: string;
    }>
  ): Promise<{
    _id: string;
    email: string;
    nickname: string;
    avatar: string;
  }> {
    const { botId, nickname, avatar } = ctx.params;
    const email = this.buildOpenapiBotEmail(botId);

    const bot = await this.adapter.model.findOne({
      email,
    });

    if (bot) {
      if (bot.nickname !== nickname || bot.avatar !== avatar) {
        /**
         * 如果信息不匹配，则更新
         */
        this.logger.info('检查到第三方机器人信息不匹配, 更新机器人信息:', {
          nickname,
          avatar,
        });
        await bot.updateOne({
          nickname,
          avatar,
        });
        await this.cleanUserInfoCache(String(bot._id));
      }
      // 同步用户名（包括清空用户名的情况）
      if (ctx.params.hasOwnProperty('username')) {
        const desired = ctx.params.username;
        
        if (desired && typeof desired === 'string') {
          // 设置用户名（不进行格式验证，信任调用方已经验证过）
          const lower = desired.toLowerCase();
          const exists = await this.adapter.model.exists({ usernameLower: lower, _id: { $ne: bot._id } });
          if (!exists) {
            if (bot.username !== desired || bot.usernameLower !== lower) {
              await bot.updateOne({ username: desired, usernameLower: lower });
              await this.cleanUserInfoCache(String(bot._id));
              this.logger.info(`Updated bot username: ${desired} for bot: ${bot._id}`);
            }
          } else {
            this.logger.warn(`Username ${desired} already exists, skipping update for bot: ${bot._id}`);
          }
        } else if (desired === null || desired === '') {
          // 明确清空用户名
          if (bot.username || bot.usernameLower) {
            await bot.updateOne({
              $unset: {
                username: 1,
                usernameLower: 1,
              },
            });
            await this.cleanUserInfoCache(String(bot._id));
            this.logger.info(`Cleared username for bot: ${bot._id}`);
          }
        }
        // 如果是 undefined，则不做任何操作（保持现有用户名）
      }

      return {
        _id: String(bot._id),
        email,
        nickname,
        avatar,
      };
    }

    // 如果不存在，则创建
    const doc: any = {
      email,
      nickname,
      avatar,
      type: 'openapiBot',
    };
    // 可选写入 username（需严格校验与唯一）
    if (ctx.params.hasOwnProperty('username')) {
      const desired = ctx.params.username;
      if (desired && typeof desired === 'string') {
        // 创建机器人时不进行格式验证，信任调用方已经验证过
        const lower = desired.toLowerCase();
        const exists = await this.adapter.model.exists({ usernameLower: lower });
        if (!exists) {
          doc.username = desired;
          doc.usernameLower = lower;
          this.logger.info(`Creating new bot with username: ${desired}`);
        } else {
          this.logger.warn(`Username ${desired} already exists, creating bot without username`);
        }
      }
      // 如果是 null、'' 或 undefined，则不设置用户名（创建时默认没有用户名）
    }
    const newBot = await this.adapter.model.create(doc);

    return {
      _id: String(newBot._id),
      email,
      nickname,
      avatar,
    };
  }

  /**
   * 根据用户邮箱获取开放平台机器人id
   */
  findOpenapiBotId(ctx: TcContext<{ email: string }>): string {
    return this.parseOpenapiBotEmail(ctx.params.email);
  }

  async generateUserToken(
    ctx: TcContext<{
      userId: string;
      nickname: string;
      email: string;
      avatar: string;
    }>
  ) {
    const { userId, nickname, email, avatar } = ctx.params;

    const token = this.generateJWT({
      _id: userId,
      nickname,
      email,
      avatar,
    });

    return token;
  }

  /**
   * 为机器人签发短期 JWT，并将 btid 写入 payload 以支持即时吊销校验
   */
  async generateBotShortToken(
    ctx: TcContext<{
      userId: string;
      nickname: string;
      email: string;
      avatar: string;
      btid: string;
      expiresInSec?: number;
    }>
  ) {
    const { userId, nickname, email, avatar, btid } = ctx.params;
    const expiresInSec = ctx.params.expiresInSec ?? 1800; // default 30min
    const token = jwt.sign(
      {
        _id: userId,
        nickname,
        email,
        avatar,
        btid,
      } as UserJWTPayload & { btid: string },
      this.jwtSecretKey,
      { expiresIn: expiresInSec }
    );
    return { token };
  }

  /**
   * 清理当前用户的缓存信息
   */
  private async cleanCurrentUserCache(ctx: TcContext) {
    const { token, userId } = ctx.meta;
    await Promise.all([
      this.cleanActionCache('resolveToken', [token]),
      this.cleanActionCache('getUserInfo', [userId]),
      this.cleanPublicUserCacheByUserId(userId),
    ]);
  }

  /**
   * 根据用户ID清理缓存信息
   */
  private async cleanUserInfoCache(userId: string) {
    await Promise.all([
      this.cleanActionCache('getUserInfo', [String(userId)]),
      this.cleanPublicUserCacheByUserId(userId),
    ]);
  }

  private buildPublicUserCacheKey(usernameLower: string): string {
    return `user:public:${usernameLower}`;
  }

  private async cleanPublicUserCacheByUserId(userId?: string) {
    if (!userId || !this.broker.cacher) {
      return;
    }

    try {
      const doc = await this.adapter.model
        .findById(userId, { usernameLower: 1 })
        .lean();
      const usernameLower = doc?.usernameLower;
      if (typeof usernameLower === 'string' && usernameLower.length > 0) {
        await this.broker.cacher.del(this.buildPublicUserCacheKey(usernameLower));
      }
    } catch (err) {
      this.logger.warn?.('Failed to clean public user cache', String(err));
    }
  }

  /**
   * Transform returned user entity. Generate JWT token if neccessary.
   *
   * @param {Object} user
   * @param {Boolean} withToken
   */
  private async transformEntity(user: any, withToken: boolean, token?: string) {
    if (user) {
      //user.avatar = user.avatar || "https://www.gravatar.com/avatar/" + crypto.createHash("md5").update(user.email).digest("hex") + "?d=robohash";
      if (withToken) {
        if (token !== undefined) {
          // 携带了token
          try {
            await this.verifyJWT(token);
            // token 可用, 原样传回
            user.token = token;
          } catch (err) {
            // token 不可用, 生成一个新的返回
            user.token = this.generateJWT(user);
          }
        } else {
          // 没有携带token 生成一个
          user.token = this.generateJWT(user);
        }
      }
    }

    return user;
  }

  private async verifyJWT(token: string): Promise<UserJWTPayload> {
    const decoded = await new Promise<UserJWTPayload>((resolve, reject) => {
      jwt.verify(token, this.jwtSecretKey, (err, decoded: UserJWTPayload) => {
        if (err) return reject(err);

        resolve(decoded);
      });
    });

    return decoded;
  }

  /**
   * 生成jwt
   */
  private generateJWT(user: {
    _id: string;
    nickname: string;
    email: string;
    avatar: string;
  }): string {
    return jwt.sign(
      {
        _id: user._id,
        nickname: user.nickname,
        email: user.email,
        avatar: user.avatar,
      } as UserJWTPayload,
      this.jwtSecretKey,
      {
        expiresIn: '30d',
      }
    );
  }

  /**
   * 校验参数合法性
   */
  private async validateRegisterParams(
    params: {
      username?: string;
      email?: string;
    },
    t: TFunction
  ) {
    if (!params.username && !params.email) {
      throw new Errors.ValidationError(t('用户名或邮箱为空'));
    }

    if (params.username) {
      // 校验用户名规则 & 唯一性
      if (!validateUsernameStrict(params.username)) {
        throw new Errors.MoleculerClientError(t('用户名不合法'), 422, '', [
          { field: 'username', message: 'invalid format' },
        ]);
      }

      const found = await this.adapter.findOne({
        usernameLower: params.username.toLowerCase(),
      });
      if (found) {
        throw new Errors.MoleculerClientError(t('用户名已存在!'), 422, '', [
          { field: 'username', message: 'is exist' },
        ]);
      }
    }

    if (params.email) {
      const found = await this.adapter.findOne({ email: params.email });
      if (found) {
        throw new Errors.MoleculerClientError(t('邮箱已存在!'), 422, '', [
          { field: 'email', message: 'is exist' },
        ]);
      }
    }
  }

  private buildPluginBotEmail(botId: string) {
    return `${botId}@plugin.msgbyte.com`;
  }

  private buildOpenapiBotEmail(botId: string) {
    return `${botId}@openapi.msgbyte.com`;
  }

  private parseOpenapiBotEmail(email: string): string | null {
    if (email.endsWith('@tailchat-openapi.com')) {
      // 旧的实现，兼容代码
      return email.replace('@tailchat-openapi.com', '');
    }

    if (email.endsWith('@openapi.msgbyte.com')) {
      return email.replace('@openapi.msgbyte.com', '');
    }

    return null;
  }

  /**
   * 构建验证邮箱的缓存key
   */
  private buildVerifyEmailKey(email: string) {
    return `verify-email:${email}`;
  }

  /**
   * Allocate a unique username based on base candidate with validation and collision resolution
   */
  private async allocateUsername(base: string, opts: { isBot: boolean }): Promise<string> {
    const isValid = (name?: string) => validateUsernameStrict(name ?? '', { isBot: opts.isBot });
    const toLower = (s: string) => s.toLowerCase();

    let candidate = base || `user_${shortHash(String(Date.now()), 4)}`;
    let i = 0;
    while (i < 100) {
      if (isValid(candidate)) {
        const exists = await this.adapter.model.exists({ usernameLower: toLower(candidate) });
        if (!exists) {
          return candidate;
        }
      }
      i += 1;
      candidate = `${base}_${i}`;
    }
    // Fallback with short hash suffix
    return `${base}_${shortHash(String(Date.now()), 4)}`;
  }

  /**
   * 更新机器人用户名
   */
  async updateBotUsername(
    ctx: TcContext<{
      userId: string;
      username?: string;
    }>
  ): Promise<boolean> {
    const { userId, username } = ctx.params;

    // 查找机器人用户
    const bot = await this.adapter.model.findById(userId);
    if (!bot) {
      throw new Error(ctx.meta.t('Bot user not found'));
    }

    // 检查是否为机器人类型
    if (!['pluginBot', 'openapiBot'].includes(bot.type)) {
      throw new Error(ctx.meta.t('User is not a bot'));
    }

    // 如果设置了用户名，需要验证
    if (username) {
      if (!validateUsernameStrict(username, { isBot: true })) {
        throw new Error(ctx.meta.t('Invalid bot username format'));
      }

      const lower = username.toLowerCase();
      
      // 检查用户名唯一性（排除当前用户）
      const exists = await this.adapter.model.exists({ 
        usernameLower: lower, 
        _id: { $ne: bot._id } 
      });
      
      if (exists) {
        throw new Error(ctx.meta.t('Username already exists'));
      }

      // 更新用户名
      await bot.updateOne({
        username: username,
        usernameLower: lower,
      });
    } else {
      // 清除用户名
      await bot.updateOne({
        $unset: {
          username: 1,
          usernameLower: 1,
        },
      });
    }

    // 清除缓存
    await this.cleanUserInfoCache(userId);

    return true;
  }

  /**
   * 删除 OpenAPI 机器人用户
   */
  async deleteOpenapiBot(
    ctx: TcContext<{
      botEmail: string;
    }>
  ): Promise<boolean> {
    const { botEmail } = ctx.params;

    try {
      // 查找机器人用户
      const botUser = await this.adapter.model.findOne({
        email: botEmail,
        type: 'openapiBot'
      });

      if (botUser) {
        // 删除机器人用户
        await this.adapter.model.deleteOne({
          _id: botUser._id
        });

        // 清除缓存
        await this.cleanUserInfoCache(String(botUser._id));

        this.logger.info(`Deleted OpenAPI bot user: ${botEmail}`);
        return true;
      } else {
        this.logger.warn(`OpenAPI bot user not found: ${botEmail}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to delete OpenAPI bot user: ${botEmail}`, error);
      throw error;
    }
  }

  /**
   * 根据用户名查找机器人用户
   */
  async findBotByUsername(
    ctx: TcContext<{
      username: string;
    }>
  ): Promise<{
    _id: string;
    email: string;
    nickname: string;
    avatar: string;
    username: string;
    type: string;
  } | null> {
    const { username } = ctx.params;

    try {
      // 查找机器人用户（只查找 pluginBot 和 openapiBot 类型）
      const botUser = await this.adapter.model.findOne({
        usernameLower: username.toLowerCase(),
        type: { $in: ['pluginBot', 'openapiBot'] }
      }).lean();

      if (!botUser) {
        return null;
      }

      return {
        _id: String(botUser._id),
        email: botUser.email,
        nickname: botUser.nickname,
        avatar: botUser.avatar,
        username: botUser.username,
        type: botUser.type,
      };
    } catch (error) {
      this.logger.error(`Failed to find bot by username: ${username}`, error);
      throw error;
    }
  }
}

export default UserService;

import { TcService, TcPureContext, Errors, config } from 'tailchat-server-sdk';
declare const require: any;

interface ClickPayload {
  botId?: string;
  actionId: string;
  type: 'url' | 'invoke' | 'modal' | 'deeplink' | 'command';
  params?: Record<string, unknown>;
  signature?: string;
  analytics?: {
    traceId?: string;
    source?: string;
  };
  // 新增：消息上下文信息
  originalMessageId?: string;
  converseId?: string;
  groupId?: string;
}

export default class InlineActionService extends TcService {
  get serviceName() {
    return 'inline.action';
  }

  // 简单内存缓冲用于 M6 批量导出（保留最近 N 条 track 事件）
  private __trackBuffer: Array<{
    ts: number;
    userId?: string;
    event: string;
    actionId?: string;
    traceId?: string;
    extra?: Record<string, unknown>;
  }> = [];
  private readonly __trackBufferMax = 1000;

  // 简单配置缓存，减少频繁读取/解析
  private __cfgCacheTs: number = 0;
  private __urlWhitelist: string[] | null = null;
  private __deeplinkWhitelist: string[] | null = null;
  private __rateCfg: any | null = null;
  private __featureCfg: any | null = null;

  private getCfgCached<T = any>(getter: () => T, ttlMs = 60_000): T {
    const now = Date.now();
    if (!this.__cfgCacheTs || now - this.__cfgCacheTs > ttlMs) {
      // 刷新缓存
      try {
        this.__urlWhitelist = (config as any)?.inlineUrlWhitelist || null;
        this.__deeplinkWhitelist = (config as any)?.inlineDeeplinkWhitelist || null;
        this.__rateCfg = ( (config as any)?.inlineActionRateLimit || null );
        this.__featureCfg = ( (config as any)?.feature || null );
      } catch {}
      this.__cfgCacheTs = now;
    }
    // 由调用方选择性返回
    return getter();
  }

  private getUrlWhitelist(): string[] {
    return this.getCfgCached(() => Array.isArray(this.__urlWhitelist) ? this.__urlWhitelist as string[] : [], 60_000);
  }

  private getDeeplinkWhitelist(): string[] {
    return this.getCfgCached(() => Array.isArray(this.__deeplinkWhitelist) ? this.__deeplinkWhitelist as string[] : ['http:', 'https:', 'tailchat:', 'tc:'], 60_000);
  }

  /**
   * Hostname 通配匹配：
   * - 支持精确匹配：example.com
   * - 支持子域匹配：*.example.com（或写成 example.com 也允许其子域）
   * 匹配规则：host === d 或 host 以 `.`+d 结尾
   */
  private isHostnameAllowed(host: string, domains: string[]): boolean {
    if (!host || !Array.isArray(domains) || domains.length === 0) return false;
    const h = String(host).toLowerCase();
    for (let raw of domains) {
      try {
        if (!raw) continue;
        let d = String(raw).toLowerCase().trim();
        if (d.startsWith('*.')) d = d.slice(2); // 归一化去掉显式 *.
        if (h === d || h.endsWith(`.${d}`)) {
          return true;
        }
      } catch {}
    }
    return false;
  }

  private getRateCfg(): { clickLimit?: number; clickWindowSec?: number; trackLimit?: number; trackWindowSec?: number } {
    return this.getCfgCached(() => (this.__rateCfg || {}) as any, 60_000) as any;
  }

  private getFeatureCfg(): any {
    return this.getCfgCached(() => this.__featureCfg || {}, 60_000);
  }

  /**
   * 根据动作类型获取所需的机器人 Scope
   */
  private requiredScopeForType(type: string): string | undefined {
    switch (type) {
      case 'invoke':
        return 'inline.invoke';
      case 'modal':
        return 'inline.modal';
      case 'url':
        return 'inline.url';
      case 'deeplink':
        return 'inline.deeplink';
      default:
        return undefined;
    }
  }

  onInit(): void {
    this.registerAction('click', this.click as any, {
      visibility: 'published',
      params: {
        actionId: 'string',
        type: 'string',
        botId: [{ type: 'string', optional: true }],
        params: [{ type: 'object', optional: true }],
        signature: [{ type: 'string', optional: true }],
        analytics: [{ type: 'object', optional: true }],
        originalMessageId: [{ type: 'string', optional: true }],
        converseId: [{ type: 'string', optional: true }],
        groupId: [{ type: 'string', optional: true }],
      },
    } as any);

    this.registerAction('track', this.track as any, {
      visibility: 'published',
      params: {
        event: 'string',
        actionId: [{ type: 'string', optional: true }],
        traceId: [{ type: 'string', optional: true }],
        extra: [{ type: 'object', optional: true }],
      },
    } as any);

    // 提供 M6：埋点 schema 查询与最近数据导出
    this.registerAction('schema', this.schema as any, {
      visibility: 'published',
    } as any);
    this.registerAction('export', this.exportTrack as any, {
      visibility: 'published',
      params: {
        since: [{ type: 'number', optional: true }], // ms timestamp
        limit: [{ type: 'number', optional: true }],
      },
    } as any);

    // 网关白名单（如有需要，可在此添加）
  }

  private async rateLimit(ctx: TcPureContext<any>, key: string, limit: number, windowSec: number) {
    const cacher = (this.broker as any).cacher;
    if (!cacher) return;
    const now = Date.now();
    const rec = (await cacher.get(key)) as { n: number; ts: number } | null;
    if (!rec) {
      await cacher.set(key, { n: 1, ts: now }, windowSec);
      return;
    }
    if (typeof rec.n !== 'number') {
      await cacher.set(key, { n: 1, ts: now }, windowSec);
      return;
    }
    if (rec.n >= limit) {
      throw new Errors.MoleculerClientError('Too Many Requests', 429, 'RATE_LIMIT');
    }
    await cacher.set(key, { n: rec.n + 1, ts: rec.ts || now }, windowSec);
  }

  /**
   * 处理非 command 类动作点击
   * M4 最小闭环：仅做入参校验与未来路由的占位，真正安全策略与路由将在后续完善
   */
  async click(ctx: TcPureContext<ClickPayload>) {
    const __startTs = Date.now();
    const { actionId, type, botId, params, signature, analytics, originalMessageId, converseId, groupId } = ctx.params;
    const t = ctx.meta?.t || ((key: string) => key); // 获取翻译函数或使用默认函数
    if (!actionId || !type) {
      throw new Errors.MoleculerClientError(t('Invalid action payload'));
    }

    // 禁止通过网关处理 command 类型
    if (type === 'command') {
      throw new Errors.MoleculerClientError('COMMAND_NOT_ALLOWED', 400, 'COMMAND_NOT_ALLOWED');
    }

    const routeBotId = String((botId || (params as any)?.botId || '') || '');
    let routed = false;
    let route: any = undefined;

    // 可选：签名校验（HMAC-SHA256，密钥使用 server config.secret 或机器人专属密钥，最小闭环）
    try {
      const featCfg = this.getFeatureCfg();
      // 默认开启签名校验；仅当显式配置为 false 时关闭
      const enableSign = (featCfg?.inlineActionRequireSignature !== false);
      if (enableSign) {
        // 缺少 HMAC 密钥时直接拒绝（防止在未配置 secret 的情况下放行）
        const secret = (config as any).secret;
        if (!secret || String(secret).length < 8) {
          throw new Errors.MoleculerClientError('Server misconfig: missing HMAC secret', 500, 'SERVER_MISCONFIG');
        }
        // 过期时间与防重放
        const p: any = params || {};
        const now = Date.now();
        const exp = Number(p?.exp || 0);
        const nonce = String(p?.nonce || '');
        // 默认窗口 2 分钟，过期或缺失直接拒绝
        if (!exp || exp < now) {
          throw new Errors.MoleculerClientError('Invalid signature (expired)', 401, 'INVALID_SIGNATURE');
        }
        if (!nonce || nonce.length < 6) {
          throw new Errors.MoleculerClientError('Invalid signature (nonce)', 401, 'INVALID_SIGNATURE');
        }
        // 重放防护：nonce 短期内只能使用一次
        try {
          const cacher = (this.broker as any).cacher;
          if (cacher) {
            const nonceKey = `inline:sig:nonce:${nonce}`;
            const hit = await cacher.get(nonceKey);
            if (hit) {
              throw new Errors.MoleculerClientError('Invalid signature (replay)', 401, 'INVALID_SIGNATURE');
            }
            // 记录 nonce，TTL 与 exp 对齐（向上取整，最多 10 分钟）
            const ttlSec = Math.min(600, Math.ceil((exp - now) / 1000) || 1);
            await cacher.set(nonceKey, 1, ttlSec);
          }
        } catch (e) {
          if (e instanceof Errors.MoleculerClientError) throw e;
        }

        // 验签（包含 exp/nonce 在 params 内）
        const base = JSON.stringify({ actionId, type, params });
        const crypto = require('crypto');
        const h = crypto.createHmac('sha256', (config as any).secret).update(base).digest('hex');
        if (!signature || signature !== h) {
          throw new Errors.MoleculerClientError('Invalid signature', 401, 'INVALID_SIGNATURE');
        }
      }
    } catch (e) {
      throw e;
    }

    // 可选：URL 白名单校验（仅 type=url 时生效）
    try {
      if (type === 'url') {
        const whitelist: string[] = this.getUrlWhitelist();
        const target = String((params as any)?.url || '');
        if (!target) throw new Errors.MoleculerClientError(t('Missing url'));
        // 协议白名单，默认仅允许 http/https
        try {
          const u = new URL(target);
          const scheme = (u.protocol || '').toLowerCase();
          if (scheme !== 'http:' && scheme !== 'https:') {
            // 审计：URL 协议拒绝
            try { ctx.emit?.('audit.inline.url.denied', { userId: (ctx.meta as any).userId, target, reason: 'scheme', ts: Date.now() }); } catch {}
            throw new Errors.MoleculerClientError('URL scheme not allowed', 403, 'URL_SCHEME_NOT_ALLOWED');
          }
        } catch {
          throw new Errors.MoleculerClientError(t('Invalid url'));
        }
        const featCfg = this.getFeatureCfg() || {};
        const requireUrlWhitelist = (featCfg.inlineUrlWhitelistRequired === true);
        if (Array.isArray(whitelist) && whitelist.length > 0) {
          const u = new URL(target);
          const ok = this.isHostnameAllowed(u.hostname, whitelist);
          if (!ok) {
            // 审计：URL 域名拒绝
            try { ctx.emit?.('audit.inline.url.denied', { userId: (ctx.meta as any).userId, target, reason: 'whitelist', ts: Date.now() }); } catch {}
            throw new Errors.MoleculerClientError('URL not allowed', 403, 'URL_NOT_ALLOWED');
          }
          // 审计：URL 通过
          try { ctx.emit?.('audit.inline.url.allowed', { userId: (ctx.meta as any).userId, target, ts: Date.now() }); } catch {}
        } else if (requireUrlWhitelist) {
          // 启用强制白名单但未配置任何域 → 拒绝
          try { ctx.emit?.('audit.inline.url.denied', { userId: (ctx.meta as any).userId, target, reason: 'whitelist_required', ts: Date.now() }); } catch {}
          throw new Errors.MoleculerClientError('URL not allowed (whitelist required)', 403, 'URL_NOT_ALLOWED');
        }
      }
      if (type === 'deeplink') {
        // deeplink 协议白名单校验（默认允许 http/https/tailchat/tc，可通过配置覆盖）
        const link = String((params as any)?.link || (params as any)?.url || '');
        if (!link) throw new Errors.MoleculerClientError(t('Missing deeplink'));
        const allowed: string[] = this.getDeeplinkWhitelist();
        const featCfg = this.getFeatureCfg() || {};
        const requireDeeplinkWhitelist = (featCfg.inlineDeeplinkWhitelistRequired === true);
        try {
          const u = new URL(link);
          const scheme = String(u.protocol || '').toLowerCase();
          // 若有白名单配置，必须命中；若启用强制白名单且列表为空，也拒绝
          if (Array.isArray(allowed) && allowed.length > 0) {
            if (!allowed.includes(scheme)) {
              try { ctx.emit?.('audit.inline.deeplink.denied', { userId: (ctx.meta as any).userId, target: link, reason: 'scheme', ts: Date.now() }); } catch {}
              throw new Errors.MoleculerClientError('DEEPLINK_NOT_ALLOWED', 403, 'DEEPLINK_NOT_ALLOWED');
            }
          } else if (requireDeeplinkWhitelist) {
            try { ctx.emit?.('audit.inline.deeplink.denied', { userId: (ctx.meta as any).userId, target: link, reason: 'whitelist_required', ts: Date.now() }); } catch {}
            throw new Errors.MoleculerClientError('DEEPLINK_NOT_ALLOWED', 403, 'DEEPLINK_NOT_ALLOWED');
          }
        } catch (e) {
          // 解析失败也视为不允许，降低风险
          throw new Errors.MoleculerClientError(t('INVALID_DEEPLINK'));
        }
        // 审计：Deeplink 通过
        try { ctx.emit?.('audit.inline.deeplink.allowed', { userId: (ctx.meta as any).userId, target: link, ts: Date.now() }); } catch {}
      }
    } catch (e) {
      throw e;
    }

    // 限频（按 userId + actionId），支持配置覆盖
    try {
      const uid = String((ctx.meta as any).userId || '');
      const limitCfg = this.getRateCfg() as any;
      const limit = Number(limitCfg.clickLimit ?? 20);
      const windowSec = Number(limitCfg.clickWindowSec ?? 10);
      await this.rateLimit(ctx, `inline:click:${uid}:${actionId}`, limit, windowSec);
    } catch (e) {
      throw e;
    }

    // 幂等：同一 userId + actionId + traceId 在短时间内只处理一次
    try {
      const uid = String((ctx.meta as any).userId || '');
      const trace = String(analytics?.traceId || '');
      const idemKey = `inline:click:done:${uid}:${actionId}:${trace}`;
      const cacher = (this.broker as any).cacher;
      if (cacher) {
        const hit = await cacher.get(idemKey);
        if (hit) {
          return { ok: true, routed: false, cached: true, analytics: { traceId: analytics?.traceId } } as any;
        }
      }
    } catch {}

    // Scope 校验（当调用方为机器人时需要具备对应 scope）
    try {
      const meta: any = ctx.meta || {};
      const token = meta.token;
      if (token) {
        // 从 token 中解析机器人信息与 scope（依赖 user.extractTokenMeta）
        const decoded: any = await ctx.call('user.extractTokenMeta', { token });
        if (decoded && decoded.btid) {
          // 不进行scope检查，原项目中没有botsecret
        }
      }
    } catch (e) {
      // 遵循严格策略，scope 不满足则直接拒绝
      if (e instanceof Errors.MoleculerClientError) throw e;
      // 其他解析异常按通过处理，避免影响人类用户
    }

    // TODO：Scope/权限
    (this as any).logger.info('[inline.action] click', {
      userId: (ctx.meta as any).userId,
      actionId,
      type,
      botId,
      analytics,
    });

    // 审计事件
    try {
      ctx.emit?.('audit.inline.action.click', {
        userId: (ctx.meta as any).userId,
        actionId,
        type,
        botId: routeBotId || undefined,
        traceId: analytics?.traceId,
        ts: Date.now(),
      });
    } catch {}

    // 机器人路由占位：当提供 botId 且类型为 invoke/modal 时，广播给机器人侧
    if (routeBotId && (type === 'invoke' || type === 'modal')) {
      try {
        const botInfo: any = await ctx.call('user.getUserInfo', { userId: routeBotId });
        if (botInfo && (botInfo.type === 'pluginBot' || botInfo.type === 'openapiBot')) {
          const payload = {
            botUserId: String(routeBotId),
            fromUserId: String((ctx.meta as any).userId || ''),
            actionId,
            type,
            params: params || {},
            traceId: analytics?.traceId,
            ts: Date.now(),
            // 新增：消息上下文信息
            originalMessageId: originalMessageId || undefined,
            converseId: converseId || undefined,
            groupId: groupId || undefined,
          };
          
          // 缓存 traceId 信息，供后续 answerCallbackQuery 验证使用
          if (analytics?.traceId) {
            const cacher = (this.broker as any).cacher;
            if (cacher) {
              try {
                const traceKey = `callback:trace:${analytics.traceId}`;
                await cacher.set(traceKey, {
                  botUserId: String(routeBotId),
                  fromUserId: String((ctx.meta as any).userId || ''),
                  ts: Date.now(),
                }, 30); // TTL 30秒
              } catch (cacheErr) {
                (this as any).logger.warn('[inline.action] Failed to cache traceId:', cacheErr);
              }
            }
          }
          
          try {
            (ctx as any).emit?.('bot.inline.invoke', payload);
          } catch (e1) {
            // 简单重试一次
            try { (ctx as any).emit?.('bot.inline.invoke', payload); } catch (e2) {
              try { (this as any).logger.warn('[inline.action] bot route retry failed:', String(e2)); } catch {}
            }
          }
          routed = true;
          route = { botUserId: routeBotId, event: 'bot.inline.invoke' };
        }
      } catch (e) {
        // 保守处理：路由失败不影响前端闭环
        try { (this as any).logger.warn('[inline.action] bot route failed:', String(e)); } catch {}
      }
    }

    // 系统路由信息：对 url/deeplink 返回目标，便于前端或审计使用
    try {
      if (type === 'url') {
        const target = String((params as any)?.url || '');
        if (target) {
          route = route || { type: 'url', target };
        }
      } else if (type === 'deeplink') {
        const target = String((params as any)?.link || (params as any)?.url || '');
        if (target) {
          route = route || { type: 'deeplink', target };
        }
      }
    } catch {}

    // 标记幂等完成（短期缓存 60s）
    try {
      const uid = String((ctx.meta as any).userId || '');
      const trace = String(analytics?.traceId || '');
      const idemKey = `inline:click:done:${uid}:${actionId}:${trace}`;
      const cacher = (this.broker as any).cacher;
      if (cacher) {
        await cacher.set(idemKey, 1, 60);
      }
    } catch {}

    // 最终响应
    const routeDurationMs = Math.max(0, Date.now() - __startTs);
    return {
      ok: true,
      routed,
      route,
      analytics: { traceId: analytics?.traceId },
      routeDurationMs,
    } as any;
  }

  /**
   * 埋点事件（最小闭环）
   */
  async track(
    ctx: TcPureContext<{
      event: string;
      actionId?: string;
      traceId?: string;
      extra?: Record<string, unknown>;
    }>
  ) {
    const { event, actionId, traceId, extra } = ctx.params;
    const t = ctx.meta?.t || ((key: string) => key); // 获取翻译函数或使用默认函数
    if (!event) {
      throw new Errors.MoleculerClientError(t('Invalid track payload'));
    }
    // 事件白名单（最小集）
    const allowed = new Set<string>([
      'inline.text.render',
      'inline.keyboard.render',
      'inline.command.click',
      'inline.action.click',
      'inline.action.error',
      'inline.click.routed',
      'inline.url.opened',
      'inline.deeplink.opened',
      'inline.modal.confirm',
      'inline.invoke.sent',
    ]);
    if (!allowed.has(event)) {
      throw new Errors.MoleculerClientError(t('Event not allowed'));
    }
    // 限制 extra 体积，防止滥用
    try {
      const buf: any = require('buffer');
      const size = buf.Buffer.byteLength(JSON.stringify(extra || {}), 'utf8');
      const max = Number(((config as any)?.inlineActionTrackLimit || {}).maxExtraBytes ?? 2048);
      if (size > max) {
        throw new Errors.MoleculerClientError(t('Extra too large'));
      }
    } catch (e) {
      if (e instanceof Errors.MoleculerClientError) throw e;
    }

    // 限频（按 userId + event），支持配置覆盖
    try {
      const uid = String((ctx.meta as any).userId || '');
      const limitCfg = this.getRateCfg() as any;
      const limit = Number(limitCfg.trackLimit ?? 60);
      const windowSec = Number(limitCfg.trackWindowSec ?? 10);
      await this.rateLimit(ctx, `inline:track:${uid}:${event}`, limit, windowSec);
    } catch (e) {
      throw e;
    }

    // 采样（可选）：inlineActionSampling.sampleRate ∈ (0,1]
    try {
      const sr = Number(((config as any)?.inlineActionSampling || {}).sampleRate ?? 1);
      const rate = isFinite(sr) && sr > 0 && sr <= 1 ? sr : 1;
      if (Math.random() > rate) {
        return { ok: true, sampled: false } as any;
      }
    } catch {}

    const userId = String((ctx.meta as any)?.userId || '');
    try { (this as any).logger.info('[inline.action] track', {
      userId,
      event,
      actionId,
      traceId,
      extra,
    }); } catch {}

    // 审计事件
    try {
      (ctx as any).emit?.('audit.inline.action.track', {
        userId,
        event,
        actionId,
        traceId,
        extra,
        ts: Date.now(),
      });
    } catch {}

    // 写入内存缓冲（有限大小，便于导出）
    try {
      this.__trackBuffer.push({ ts: Date.now(), userId, event, actionId, traceId, extra });
      if (this.__trackBuffer.length > this.__trackBufferMax) {
        this.__trackBuffer.splice(0, this.__trackBuffer.length - this.__trackBufferMax);
      }
    } catch {}
    return { ok: true };
  }

  /**
   * 返回事件白名单 schema（M6）
   */
  async getSchema(ctx: TcPureContext) {
    const allowed = [
      'inline.text.render',
      'inline.keyboard.render',
      'inline.command.click',
      'inline.action.click',
      'inline.url.opened',
      'inline.deeplink.opened',
      'inline.modal.confirm',
      'inline.invoke.sent',
    ];
    return { events: allowed, fields: ['ts', 'userId', 'event', 'actionId', 'traceId', 'extra'] };
  }

  /**
   * 导出最近的 track 事件（内存）
   */
  async exportTrack(ctx: TcPureContext<{ since?: number; limit?: number }>) {
    const since = Number((ctx.params as any)?.since || 0);
    const limit = Math.max(1, Math.min(1000, Number((ctx.params as any)?.limit || 500)));
    const now = Date.now();
    const items = this.__trackBuffer.filter((e) => (since ? e.ts >= since : true));
    // 逆序返回最近数据
    const result = items.sort((a, b) => b.ts - a.ts).slice(0, limit);
    return { now, count: result.length, items: result } as any;
  }
}



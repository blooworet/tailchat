import type { IncomingMessage, ServerResponse } from 'http';
import _ from 'lodash';
import { TcSocketIOService } from '../../mixins/socketio.mixin';
import {
  TcService,
  UserJWTPayload,
  config,
  t,
  parseLanguageFromHead,
  builtinAuthWhitelist,
  PureContext,
  ApiGatewayMixin,
  ApiGatewayErrors,
} from 'tailchat-server-sdk';
import { TcHealth } from '../../mixins/health.mixin';
import type { Readable } from 'stream';
import { checkPathMatch } from '../../lib/utils';
import serve from 'serve-static';
import accepts from 'accepts';
import send from 'send';
import path from 'path';
import mime from 'mime';

export default class ApiService extends TcService {
  authWhitelist = [];

  get serviceName() {
    return 'gateway';
  }

  onInit() {
    this.registerMixin(ApiGatewayMixin);
    this.registerMixin(
      TcSocketIOService({
        userAuth: async (credential) => {
          // 优先按 JWT 解析，失败则按 appSecret 解析为机器人用户
          try {
            const user: UserJWTPayload = await this.broker.call(
              'user.resolveToken',
              {
                token: credential,
              }
            );
            return user;
          } catch (e) {
            // 尝试作为 appSecret 进行开放平台机器人鉴权
            const valid = await this.broker.call('openapi.app.authToken', {
              token: credential,
              capability: ['bot'],
            });
            if (!valid) {
              throw e;
            }
            const bot: any = await this.broker.call('openapi.bot.getOrCreateBotAccount', {
              appSecret: credential,
            });
            // 组装与 JWT 一致的用户负载
            return {
              _id: bot.userId,
              nickname: bot.nickname,
              email: bot.email,
              avatar: bot.avatar,
            } as UserJWTPayload;
          }
        },
        disableMsgpack: config.feature.disableMsgpack,
      })
    );
    this.registerMixin(TcHealth());

    // More info about settings: https://moleculer.services/docs/0.14/moleculer-web.html
    this.registerSetting('port', config.port);
    this.registerSetting('routes', this.getRoutes());
    // Do not log client side errors (does not log an error response when the error.code is 400<=X<500)
    this.registerSetting('log4XXResponses', false);
    // Logging the request parameters. Set to any log level to enable it. E.g. "info"
    this.registerSetting('logRequestParams', null);
    // Logging the response data. Set to any log level to enable it. E.g. "info"
    this.registerSetting('logResponseData', null);
    // Serve assets from "public" folder
    // this.registerSetting('assets', {
    //   folder: 'public',
    //   // Options to `server-static` module
    //   options: {},
    // });
    this.registerSetting('cors', {
      // Configures the Access-Control-Allow-Origin CORS header.
      origin: '*',
      // Configures the Access-Control-Allow-Methods CORS header.
      methods: ['GET', 'OPTIONS', 'POST', 'PUT', 'DELETE'],
      // Configures the Access-Control-Allow-Headers CORS header.
      allowedHeaders: ['X-Token', 'X-App-Secret', 'Content-Type'],
      // Configures the Access-Control-Expose-Headers CORS header.
      exposedHeaders: [],
      // Configures the Access-Control-Allow-Credentials CORS header.
      credentials: false,
      // Configures the Access-Control-Max-Age CORS header.
      maxAge: 3600,
    });
    // this.registerSetting('rateLimit', {
    //   // How long to keep record of requests in memory (in milliseconds).
    //   // Defaults to 60000 (1 min)
    //   window: 60 * 1000,

    //   // Max number of requests during window. Defaults to 30
    //   limit: 60,

    //   // Set rate limit headers to response. Defaults to false
    //   headers: true,

    //   // Function used to generate keys. Defaults to:
    //   key: (req) => {
    //     return (
    //       req.headers['x-forwarded-for'] ||
    //       req.connection.remoteAddress ||
    //       req.socket.remoteAddress ||
    //       req.connection.socket.remoteAddress
    //     );
    //   },
    // });

    this.registerMethod('authorize', this.authorize);

    this.registerEventListener(
      'gateway.auth.addWhitelists',
      ({ urls = [] }) => {
        this.logger.info('Add auth whitelist:', urls);
        this.authWhitelist.push(...urls);
      }
    );
  }

  getRoutes() {
    return [
      // /api
      {
        path: '/api',
        whitelist: [
          // Access to any actions in all services under "/api" URL
          '**',
        ],
        // Route-level Express middlewares. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Middlewares
        use: [],
        // Enable/disable parameter merging method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Disable-merging
        mergeParams: true,

        // Enable authentication. Implement the logic into `authenticate` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authentication
        authentication: false,

        // Enable authorization. Implement the logic into `authorize` method. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Authorization
        authorization: true,

        // The auto-alias feature allows you to declare your route alias directly in your services.
        // The gateway will dynamically build the full routes from service schema.
        autoAliases: true,

        aliases: {
        },
        /**
         * Before call hook. You can check the request.
         * @param {PureContext} ctx
         * @param {Object} route
         * @param {IncomingMessage} req
         * @param {ServerResponse} res
         * @param {Object} data*/
        onBeforeCall(
          ctx: PureContext<any, { userAgent: string; language: string }>,
          route: object,
          req: IncomingMessage,
          res: ServerResponse
        ) {
          // Enforce WS-only for specific endpoints
          const url = String((req as any).originalUrl || (req as any).url || '');
          const pathname = url.split('?')[0] || '';
          const isPublicUserProfile = pathname.startsWith('/api/user/public/');
          if (
            url.includes('/chat/message/') ||
            url.includes('/chat/converse/') || // block all chat.converse HTTP APIs
            url.includes('/chat/ack/') || // block all chat.ack HTTP APIs
            url.includes('/chat/inbox/') ||
            url.includes('/plugin/registry/list') ||
            url.includes('/openapi/integration/addBotUserByUsername') ||
            (url.includes('/user/') && !isPublicUserProfile) ||
            url.includes('/friend/') || // block all friend HTTP APIs (use WS)
            url.includes('/group/') || // block all group HTTP APIs (use WS)
            url.includes('/config/') || // block all config HTTP APIs (use WS)
            url.includes('/gateway/health') || // block /api/gateway/health (use WS)
            url.includes('/gateway/checkUserOnline')
          ) {
            throw new ApiGatewayErrors.UnAuthorizedError(
              ApiGatewayErrors.ERR_INVALID_TOKEN,
              { error: 'TailProto only: HTTP disabled for this API. Use WebSocket.' }
            );
          }
          // Set request headers to context meta
          ctx.meta.userAgent = req.headers['user-agent'];
          ctx.meta.language = parseLanguageFromHead(
            req.headers['accept-language']
          );
        },

        /**
         * After call hook. You can modify the data.
         * @param {PureContext} ctx
         * @param {Object} route
         * @param {IncomingMessage} req
         * @param {ServerResponse} res
         * @param {Object} data
         *
         */
        onAfterCall(
          ctx: PureContext,
          route: object,
          req: IncomingMessage,
          res: ServerResponse,
          data: object
        ) {
          // Async function which return with Promise
          res.setHeader('X-Node-ID', ctx.nodeID);

          if (data && data['__raw']) {
            // 如果返回值有__raw, 则视为返回了html片段
            if (data['header']) {
              Object.entries(data['header']).forEach(([key, value]) => {
                res.setHeader(key, String(value));
              });
            }

            res.write(data['html'] ?? '');
            res.end();
            return;
          }

          return { code: res.statusCode, data };
        },

        // Calling options. More info: https://moleculer.services/docs/0.14/moleculer-web.html#Calling-options
        callingOptions: {},

        bodyParsers: {
          json: {
            strict: false,
            limit: '1MB',
          },
          urlencoded: {
            extended: true,
            limit: '1MB',
          },
        },

        // Mapping policy setting. Allow dynamic mapping; selective blocking is in onBeforeCall above.
        mappingPolicy: 'all', // Available values: "all", "restrict"

        // Enable/disable logging
        logging: true,
      },
      // /upload
      {
        // Reference: https://github.com/moleculerjs/moleculer-web/blob/master/examples/file/index.js
        path: '/upload',
        // You should disable body parsers
        bodyParsers: {
          json: false,
          urlencoded: false,
        },

        authentication: false,
        authorization: true,

        aliases: {
          // File upload from HTML form
          'POST /': {
            type: 'multipart',
            action: 'file.save',
          },

          // File upload from AJAX or cURL
          'PUT /': {
            type: 'stream',
            action: 'file.save',
          },
        },

        // https://github.com/mscdex/busboy#busboy-methods
        busboyConfig: {
          limits: {
            files: 1,
            fileSize: config.storage.limit,
          },
          onPartsLimit(busboy, alias, svc) {
            this.logger.info('Busboy parts limit!', busboy);
          },
          onFilesLimit(busboy, alias, svc) {
            this.logger.info('Busboy file limit!', busboy);
          },
          onFieldsLimit(busboy, alias, svc) {
            this.logger.info('Busboy fields limit!', busboy);
          },
        },

        callOptions: {
          meta: {
            a: 5,
          },
        },

        mappingPolicy: 'restrict',
      },
      // /health
      {
        path: '/health',
        aliases: {
          'GET /': 'gateway.health',
        },
        mappingPolicy: 'restrict',
      },
      // /static 对象存储文件代理
      {
        path: '/static',
        authentication: false,
        authorization: false,
        aliases: {
          async 'GET /:objectName+'(
            this: TcService,
            req: IncomingMessage,
            res: ServerResponse
          ) {
            const objectName = _.get(req, '$params.objectName');

            try {
              const result: Readable = await this.broker.call(
                'file.get',
                {
                  objectName,
                },
                {
                  parentCtx: _.get(req, '$ctx'),
                }
              );

              const ext = path.extname(objectName);
              if (ext) {
                res.setHeader('Content-Type', mime.getType(ext));
              }

              // 因为对象存储的对象名都是以文件内容hash存储的，因此过期时间可以设置很大
              res.setHeader('Cache-Control', 'public, max-age=315360000'); // 10 years => 60 * 60 * 24 * 365 * 10

              result.pipe(res);
            } catch (err) {
              this.logger.error(err);
              res.write('static file not found');
              res.end();
            }
          },
        },
        mappingPolicy: 'restrict',
      },
      // 静态文件代理
      {
        path: '/',
        authentication: false,
        authorization: false,
        use: [
          serve('public', {
            cacheControl: true,
            maxAge: '1d', // 1 day for public file, include plugins
            setHeaders(res: ServerResponse, path: string, stat: any) {
              res.setHeader('Access-Control-Allow-Origin', '*'); // 允许跨域
            },
          }),
        ],
        onError(req: IncomingMessage, res: ServerResponse, err) {
          if (
            String(req.method).toLowerCase() === 'get' && // get请求
            accepts(req).types(['html']) && // 且请求html页面
            err.code === 404
          ) {
            // 如果没有找到, 则返回index.html(for spa)
            this.logger.info('fallback to fe entry file');
            send(req, './public/index.html', { root: process.cwd() }).pipe(res);
          }
        },
        whitelist: [],
        autoAliases: false,
      },
    ];
  }

  /**
   * 获取鉴权白名单
   * 在白名单中的路由会被跳过
   */
  getAuthWhitelist() {
    return _.uniq([...builtinAuthWhitelist, ...this.authWhitelist]);
  }

  /**
   * jwt秘钥
   */
  get jwtSecretKey() {
    return config.secret;
  }

  async authorize(
    ctx: PureContext<{}, any>,
    route: unknown,
    req: IncomingMessage
  ) {
    // Block HTTP access for restricted APIs at the earliest phase
    const url = String((req as any).originalUrl || (req as any).url || '');
    const pathname = url.split('?')[0] || '';

    // Allow public user profile endpoint without auth & before generic /user/ block
    // Note: whitelist checkPathMatch can't match dynamic ':username', so use prefix here
    if (pathname.startsWith('/api/user/public/')) {
      return null;
    }

    if (
      pathname.includes('/chat/message/') ||
      pathname.includes('/chat/converse/') || // block all chat.converse HTTP APIs
      pathname.includes('/chat/ack/') || // block all chat.ack HTTP APIs
      pathname.includes('/chat/inbox/') ||
      pathname.includes('/plugin/registry/list') ||
      pathname.includes('/openapi/integration/addBotUserByUsername') ||
      pathname.includes('/user/') ||
      pathname.includes('/friend/') || // block all friend HTTP APIs (use WS)
      pathname.includes('/group/') || // block all group HTTP APIs (use WS)
      pathname.includes('/config/') || // block all config HTTP APIs (use WS)
      pathname.includes('/gateway/health') || // block /api/gateway/health (use WS)
      pathname.includes('/gateway/checkUserOnline')
    ) {
      throw new ApiGatewayErrors.UnAuthorizedError(
        ApiGatewayErrors.ERR_INVALID_TOKEN,
        { error: 'TailProto only: HTTP disabled for this API. Use WebSocket.' }
      );
    }
    // 优先支持 X-App-Secret：一旦提供且校验通过，则全路径生效（不限 /openapi/）
    const appSecretHeader = req.headers['x-app-secret'] as string | undefined;
    if (typeof appSecretHeader === 'string' && appSecretHeader.length > 0) {
      // 校验 appSecret 能力
      const valid = await ctx.call('openapi.app.authToken', {
        token: appSecretHeader,
        capability: ['bot'],
      });
      if (!valid) {
        throw new ApiGatewayErrors.UnAuthorizedError(
          ApiGatewayErrors.ERR_INVALID_TOKEN,
          { error: 'Invalid AppSecret' }
        );
      }

      // 获取/创建机器人账号，并注入 meta
      const bot: any = await ctx.call('openapi.bot.getOrCreateBotAccount', {
        appSecret: appSecretHeader,
      });

      ctx.meta.user = _.pick(
        {
          _id: bot?.userId,
          nickname: bot?.nickname,
          email: bot?.email,
          avatar: bot?.avatar,
        },
        ['_id', 'nickname', 'email', 'avatar']
      );
      // 注意：不要将 appSecret 作为 JWT 透传，否则下游按 JWT 校验会报错
      // ctx.meta.token 保留为未设置，改用机器人标识
      ctx.meta.userId = bot?.userId;
      // 标识为机器人调用，供下游按需放行
      (ctx.meta as any).isBot = true;
      // 透传 AppSecret，便于下游无需从请求体重复传参
      (ctx.meta as any).appSecret = appSecretHeader;

      this.logger.info('[Web][AppSecret] Authenticated via AppSecret: ', bot?.nickname);
      return null; // 通过鉴权
    }
    if (checkPathMatch(this.getAuthWhitelist(), req.url)) {
      // 即使命中白名单，也尽量从请求头透传 X-Token，供下游可选使用
      const headerToken = req.headers['x-token'] as string;
      if (typeof headerToken === 'string') {
        ctx.meta.token = headerToken;
      }
      return null;
    }

    const token = req.headers['x-token'] as string;

    if (typeof token !== 'string') {
      throw new ApiGatewayErrors.UnAuthorizedError(
        ApiGatewayErrors.ERR_NO_TOKEN,
        {
          error: 'No Token',
        }
      );
    }

    // Verify JWT token
    try {
      const user: UserJWTPayload = await ctx.call('user.resolveToken', {
        token,
      });

      if (user && user._id) {
        this.logger.info('[Web] Authenticated via JWT: ', user.nickname);
        // Reduce user fields (it will be transferred to other nodes)
        ctx.meta.user = _.pick(user, ['_id', 'nickname', 'email', 'avatar']);
        ctx.meta.token = token;
        ctx.meta.userId = user._id;

          // P1: 若是 bot 短期登录（btid 存在），按 scopes 做 API 级别的基础门控
          const decoded: any = await ctx.call('user.extractTokenMeta', { token });
          if (decoded && decoded.btid) {
            try {
              const rec = await (require('../../models/bottoken').default).findById(decoded.btid).lean().exec();
              if (rec && Array.isArray(rec.scopes)) {
                // 简化示例：限制无 'socket' scope 的 bot 无法进行 WebSocket 鉴权
                const isSocketHandshake = String(req.url || '').startsWith('/socket.io');
                if (isSocketHandshake && !rec.scopes.includes('socket')) {
                  throw new Error(t('Bot scope denied: socket'));
                }
              }
            } catch (e) {
              throw new ApiGatewayErrors.UnAuthorizedError(
                ApiGatewayErrors.ERR_INVALID_TOKEN,
                { error: 'Scope denied' }
              );
            }
          }
      } else {
        throw new Error(t('Token不合规'));
      }
    } catch (err) {
      throw new ApiGatewayErrors.UnAuthorizedError(
        ApiGatewayErrors.ERR_INVALID_TOKEN,
        {
          error: 'Invalid Token:' + String(err),
        }
      );
    }
  }
}

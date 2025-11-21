import { TcService, PureContext, config } from 'tailchat-server-sdk';
import jwt from 'jsonwebtoken';

interface AuthService extends TcService {}

/**
 * 颁发短期 WebSocket 握手票据（wsTicket）
 * 仅用于 WS 握手阶段绑定 userId，避免长期 JWT 出现在握手里
 */
class AuthService extends TcService {
  get serviceName() {
    return 'auth';
  }

  onInit() {
    this.registerAction('issueWsTicket', this.issueWsTicket, {
      // 通过 HTTP 暴露：/api/auth/issueWsTicket（需 X-Token 或 X-App-Secret）
      rest: 'POST /auth/issueWsTicket',
    });
  }

  /**
   * 颁发短期 wsTicket（JWT），payload 仅包含 { typ: 'wst', uid }
   * 有效期默认 120 秒，可通过 WS_TICKET_TTL_SEC 调整
   */
  async issueWsTicket(ctx: PureContext<{}, any>): Promise<{ wsTicket: string; expiresIn: number }>
  {
    const userId = (ctx.meta as any)?.userId as string | undefined;
    // 支持机器人：authorize 中已为 appSecret 来路注入 userId
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new Error('Unauthorized');
    }

    const ttlSec = Number(process.env.WS_TICKET_TTL_SEC || '120');
    const payload = { typ: 'wst', uid: userId } as any;
    const token = jwt.sign(payload, config.secret, { expiresIn: ttlSec });
    return { wsTicket: token, expiresIn: ttlSec };
  }
}

export default AuthService;



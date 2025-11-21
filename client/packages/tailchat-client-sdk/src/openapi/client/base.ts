import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';

export class TailchatBaseClient {
  request: AxiosInstance;
  jwt: string | null = null;
  userId: string | null = null;
  loginP: Promise<void>;
  private _transformOutgoingMessage?: (payload: {
    converseId: string;
    groupId?: string;
    content: string;
    plain?: string;
    meta?: object;
  }) => Promise<any> | any;

  constructor(
    public url: string,
    public appSecret: string,
    public appId: string = '' // 保留参数以兼容旧版本，但默认为空字符串
  ) {
    if (!url || !appSecret) {
      throw new Error(
        'Require params: apiUrl, appSecret. You can set it with env'
      );
    }

    this.request = axios.create({
      baseURL: url,
    });
    this.request.interceptors.request.use(async (val) => {
      if (
        this.jwt &&
        ['post', 'get'].includes(String(val.method).toLowerCase()) &&
        !val.headers['X-Token']
      ) {
        // 任何请求都尝试增加token
        val.headers['X-Token'] = this.jwt;
      }

      return val;
    });
    this.loginP = this.login();
  }

  async login() {
    try {
      console.log('Login...');
      const { data } = await this.request.post('/api/openapi/bot/login', {
        token: this.appSecret, // 直接使用appSecret作为token
      });

      this.jwt = data.data?.jwt;
      this.userId = data.data?.userId;

      console.log('tailchat openapp login success!');

      // 尝试调用函数
      // this.whoami().then(console.log);
    } catch (err) {
      console.error(err);
      throw new Error(
        `Login failed, please check application credentials or network(Error: ${String(
          err
        )})`
      );
    }
  }

  async waitingForLogin(): Promise<void> {
    await Promise.resolve(this.loginP);
  }

  async call(action: string, params = {}) {
    try {
      await this.waitingForLogin();
      console.log('Calling:', action);
      const { data } = await this.request.post(
        '/api/' + action.replace(/\./g, '/'),
        params
      );

      return data.data;
    } catch (err: any) {
      console.error('Service Call Failed:', err);
      const data: string = err?.response?.data;
      if (data) {
        throw new Error(
          JSON.stringify({
            action,
            data,
          })
        );
      } else {
        throw err;
      }
    }
  }

  async whoami(): Promise<{
    userAgent: string;
    language: string;
    user: {
      _id: string;
      nickname: string;
      email: string;
      avatar: string;
    };
    token: string;
    userId: string;
  }> {
    return this.call('user.whoami');
  }

  getBotToken() {
    // 为了向后兼容，保留此方法但直接返回appSecret
    return this.appSecret;
  }

  /**
   * Send normal message to tailchat
   */
  async sendMessage(payload: {
    converseId: string;
    groupId?: string;
    content: string;
    plain?: string;
    meta?: object;
  }) {
    const next = this._transformOutgoingMessage
      ? await this._transformOutgoingMessage(payload)
      : payload;
    return this.call('chat.message.sendMessage', next);
  }

  /**
   * Reply message
   */
  async replyMessage(
    replyInfo: {
      messageId: string;
      author: string;
      content: string;
    },
    payload: {
      converseId: string;
      groupId?: string;
      content: string;
      plain?: string;
      meta?: object;
    }
  ) {
    return this.sendMessage({
      ...payload,
      meta: {
        ...payload.meta,
        mentions: [replyInfo.author],
        reply: {
          _id: replyInfo.messageId,
          author: replyInfo.author,
          content: replyInfo.content,
        },
      },
      content: `[at=${replyInfo.author}][/at] ${payload.content}`,
    });
  }
}

export interface TailchatMessageTransformer {
  (payload: {
    converseId: string;
    groupId?: string;
    content: string;
    plain?: string;
    meta?: object;
  }): Promise<any> | any;
}

export interface TailchatBaseClient {
  /**
   * 设置消息发送前的可选转换器（例如加密）
   */
  setMessageTransformer(transformer?: TailchatMessageTransformer): void;
}

// 使用声明合并为类添加方法实现
(TailchatBaseClient as any).prototype.setMessageTransformer = function (
  this: any,
  transformer?: (payload: any) => any
) {
  this._transformOutgoingMessage = transformer;
};

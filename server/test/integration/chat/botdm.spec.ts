import { createTestServiceBroker } from '../../utils';
import MessageService from '../../../services/core/chat/message.service';
import { Types } from 'mongoose';

describe('Bot DM /start flow', () => {
  const { broker, service, insertTestData, contextCallMock } =
    createTestServiceBroker<MessageService>(MessageService, {
      contextCallMockFn(actionName, params, opts) {
        if (actionName === 'user.extractTokenMeta') {
          return {};
        }
        if (actionName === 'chat.converse.findConverseInfo') {
          // 模拟双人会话: [from, bot]
          return {
            members: [opts?.meta?.userId ?? 'u1', params.converseId],
          } as any;
        }
        if (actionName === 'user.getUserInfo') {
          // 假定第二个成员是机器人
          if (params === 'bot-user') {
            return { _id: 'bot-user', type: 'pluginBot' } as any;
          }
          return { _id: String(params), type: 'user' } as any;
        }
        if (actionName === 'user.isBotBlocked') {
          return false;
        }
        if (actionName === 'user.extractTokenMeta') {
          return {};
        }
      },
    });

  test('sending /start in bot DM emits bot.dm.start', async () => {
    const converseId = 'bot-user';
    const userId = String(new Types.ObjectId());

    const emitSpy = jest.spyOn((service as any).broker, 'emit');

    await broker.call(
      'chat.message.sendMessage',
      {
        converseId,
        content: '/start',
        plain: '/start',
      },
      {
        meta: {
          userId,
          token: 't',
        },
      }
    );

    expect(
      emitSpy.mock.calls.some((args) => args[0] === 'bot.dm.start')
    ).toBeTruthy();
  });
});



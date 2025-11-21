import React from 'react';
import { render } from '@testing-library/react';
import { defaultOnActionClick } from '@/plugin/common/inline-actions';

// 模拟依赖
jest.mock('tailchat-shared', () => ({
  // 模拟必要的 tailchat-shared 导出
  useUserInfo: () => ({ _id: 'current-user' }),
  useCachedUserInfo: () => ({ nickname: 'Test User', avatar: '' }),
  useUserSettings: () => ({ settings: {} }),
  MessageHelper: class {
    constructor(payload: any) {
      this.payload = payload;
    }
    hasReply() { return false; }
    hasForward() { return false; }
    payload: any;
  },
  t: (key: string) => key,
}));

// 模拟内联动作处理函数
jest.mock('@/plugin/common/inline-actions', () => {
  const actual = jest.requireActual('@/plugin/common/inline-actions');
  return {
    ...actual,
    defaultOnActionClick: jest.fn(),
  };
});

// 模拟 getMessageRender 函数
jest.mock('@/plugin/common', () => ({
  getMessageRender: jest.fn((text) => {
    // 模拟 BBCode 处理，特别是 @mention 标签
    if (text && typeof text === 'string' && text.includes('[at=')) {
      return <span data-testid="mention-rendered">{text}</span>;
    }
    return <span>{text}</span>;
  }),
  pluginMessageExtraParsers: [],
}));

describe('@mention 功能测试', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  // 动态导入实际组件，以避免循环依赖问题
  it('应该优先处理包含 @mention 的消息', async () => {
    const { ChatMessageItem } = await import('../Item');
    
    const mentionPayload = {
      _id: 'msg1',
      content: '你好 [at=user1]张三[/at]，欢迎!',
      author: 'user2',
      createdAt: new Date().toISOString(),
    };
    
    const { getByTestId } = render(
      <ChatMessageItem showAvatar={true} payload={mentionPayload} />
    );
    
    // 验证 mention 被正确渲染
    expect(getByTestId('mention-rendered')).toBeTruthy();
    
    // 验证 defaultOnActionClick 未被调用(因为我们应该优先使用BBCode渲染)
    expect(defaultOnActionClick).not.toHaveBeenCalled();
  });
});

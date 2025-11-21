import React from 'react';
import { renderInlineText, tokenizeWithRanges, InlineActionItem } from '../index';
import { render } from '@testing-library/react';

// 模拟 getMessageRender 函数
jest.mock('@/plugin/common', () => ({
  getMessageRender: jest.fn((text) => {
    // 简单模拟 BBCode 处理，特别是 [at] 标签
    if (text && text.includes('[at=')) {
      const regex = /\[at=([^\]]+)]([^\[]+)\[\/at]/g;
      return text.replace(regex, (_, userId, userName) => (
        <span className="mock-mention" data-userid={userId}>@{userName}</span>
      ));
    }
    return text;
  }),
}));

describe('BBCode 兼容性测试', () => {
  // 重置 mocks
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('tokenizeWithRanges 不应该分割 [at] 标签', () => {
    const text = '你好 [at=123]用户名[/at]，欢迎!';
    const ranges = [
      { offset: 0, length: 2, actionId: 'test-action-1' } // "你好" 部分
    ];
    
    const nodes = tokenizeWithRanges(text, ranges);
    
    // 应该有三个节点："你好"（动作文本），" [at=123]用户名[/at]，欢迎!"（普通文本）
    expect(nodes.length).toBe(2);
    expect(nodes[0].type).toBe('action-text');
    expect(nodes[1].type).toBe('text');
    
    // 第二个节点应该包含完整的 [at] 标签
    expect(nodes[1].text).toBe(' [at=123]用户名[/at]，欢迎!');
  });
  
  test('renderInlineText 应该正确处理包含 [at] 标签的文本', () => {
    const text = '命令: /start [at=123]用户名[/at]';
    const nodes = tokenizeWithRanges(text, []);
    
    // 模拟动作项
    const actions: Record<string, InlineActionItem> = {};
    
    const { container } = render(renderInlineText(nodes, { actions }));
    
    // 验证 getMessageRender 被调用
    expect(require('@/plugin/common').getMessageRender).toHaveBeenCalled();
    
    // 检查 mock-mention 是否在渲染结果中
    expect(container.innerHTML).toContain('mock-mention');
    expect(container.innerHTML).toContain('data-userid="123"');
  });
  
  test('当有内联动作和 BBCode 标签混合时，应该优先保护 BBCode', () => {
    const text = '命令: /help，请 [at=123]用户名[/at] 查看文档';
    const ranges = [
      { offset: 3, length: 5, actionId: 'cmd-help' } // "/help" 部分
    ];
    
    const nodes = tokenizeWithRanges(text, ranges);
    
    // 确保节点分割正确，且 [at] 标签保持完整
    expect(nodes.length).toBe(3);
    expect(nodes[0].type).toBe('text');
    expect(nodes[1].type).toBe('action-text');
    expect(nodes[2].type).toBe('text');
    
    // 第三个节点应该包含完整的 [at] 标签
    expect(nodes[2].text).toContain('[at=123]');
    expect(nodes[2].text).toContain('[/at]');
  });
});

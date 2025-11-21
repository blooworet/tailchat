import React from 'react';
import {
  regMessageRender,
  regMessageTextDecorators,
} from '@capital/common';

const PLUGIN_ID = 'com.msgbyte.bbcode';

// 🚀 改为静态导入，提高性能和稳定性
import BBCodeRender from './render';
import { bbcodeToPlainText as serialize } from './bbcode/serialize';

// 直接使用静态导入的组件，不需要Loadable包装
const BBCode = BBCodeRender;

regMessageRender((message) => {
  return <BBCode plainText={message} />;
});

regMessageTextDecorators(() => ({
  url: (url, label?) =>
    label ? `[url=${url}]${label}[/url]` : `[url]${url}[/url]`,
  image: (plain, attrs) => {
    if (attrs.height && attrs.width) {
      return `[img height=${attrs.height} width=${attrs.width}]${plain}[/img]`;
    }

    return `[img]${plain}[/img]`;
  },
  card: (plain, attrs) => {
    const h = [
      'card',
      ...Object.entries(attrs).map(([k, v]) => {
        // 属性值需要用双引号包围，避免特殊字符干扰BBCode解析
        const escapedValue = String(v).replace(/"/g, '&quot;');
        return `${k}="${escapedValue}"`;
      }),
    ].join(' ');

    return `[${h}]${plain}[/card]`;
  },
  mention: (userId, userName) => `[at=${userId}]${userName}[/at]`,
  emoji: (emojiCode) => `[emoji]${emojiCode}[/emoji]`,
  serialize: (plain: string) => serialize(plain),
}));

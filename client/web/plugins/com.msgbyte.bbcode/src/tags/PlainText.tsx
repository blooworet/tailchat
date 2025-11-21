import React, { PropsWithChildren } from 'react';
import type { TagProps } from '../bbcode/type';

export const PlainText: React.FC<PropsWithChildren<TagProps>> = React.memo(
  (props) => {
    const text = String(props.children ?? '');
    
    // 简单的纯文本渲染，不进行任何命令解析
    // 斜杠命令解析由统一的解析器处理，避免与改造7的实现冲突
    return (
      <pre style={{ display: 'inline', whiteSpace: 'break-spaces' }}>{text}</pre>
    );
  }
);
PlainText.displayName = 'PlainText';
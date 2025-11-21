import { pluginUserExtraInfo } from '@/plugin/common';
import React from 'react';

export function usePluginUserExtraInfo(
  userExtra: Record<string, unknown> = {}
): JSX.Element | null {
  const elements = pluginUserExtraInfo.map((item: any, i: number) => {
    const Component = item.component?.render;
    if (Component && typeof Component === 'function') {
      // 自定义渲染方式
      return <Component key={item.name + i} value={userExtra[item.name]} />;
    }

    // 默认渲染方式
    return (
      <div key={item.name + i} className="flex">
        <div className="w-1/4 text-gray-500">{item.label}:</div>
        <div className="w-3/4">
          {userExtra[item.name] ? String(userExtra[item.name]) : ''}
        </div>
      </div>
    );
  });

  return elements.length > 0 ? <>{elements}</> : null;
}

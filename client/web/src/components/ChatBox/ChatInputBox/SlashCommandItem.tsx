import React from 'react';
import { SlashCommand } from 'tailchat-shared/types/command';
import { UserAvatar } from '../../UserAvatar';

interface SlashCommandItemProps {
  command: SlashCommand;
}

/**
 * 斜杠命令列表项渲染组件 - Telegram 风格
 * 显示机器人头像（如果是bot类型命令）、命令名和描述
 */
export const SlashCommandItem: React.FC<SlashCommandItemProps> = React.memo(({ command }) => {
  // ✅ 判断是否为机器人命令
  const isBotCommand = command.type === 'bot';
  const hasBotUserId = isBotCommand && !!command.botUserId;

  return (
    <div className="flex items-center">
      {/* 1️⃣ 机器人头像 */}
      {hasBotUserId && (
        <UserAvatar 
          userId={command.botUserId!} 
          size={20}
        />
      )}

      {/* 2️⃣ 命令名 + 参数提示 */}
      <div className={`font-medium text-sm text-gray-900 dark:text-gray-100 flex-shrink-0 ${hasBotUserId ? 'ml-3' : ''}`}>
        {command.label}
        {command.requiresArgs && command.argsHint && (
          <span className="text-xs text-gray-400 ml-1">
            {command.argsHint}
          </span>
        )}
      </div>

      {/* 3️⃣ 命令描述 */}
      {command.description && (
        <div className="text-xs text-gray-500 dark:text-gray-400 flex-1 truncate ml-3">
          {command.description}
        </div>
      )}
    </div>
  );
});

SlashCommandItem.displayName = 'SlashCommandItem';
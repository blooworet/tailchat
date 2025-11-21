import React, { useMemo, useEffect } from 'react';
import { t } from 'tailchat-shared';
import { useSlashCommands } from '@/hooks/useSlashCommands';
import { SlashCommandItem } from './SlashCommandItem';
// import { t } from 'tailchat-shared';
import type { ChatContext } from 'tailchat-shared/types/command';
import type { InputStateManager } from '@/types/inputState';
import { InputMode, StateTransitionEvent } from '@/types/inputState';

interface ExpandedCommandListProps {
  query: string;
  chatContext?: ChatContext;
  onCommandSelect: (command: any) => void;
  onClose?: () => void;
  inputStateManager?: InputStateManager;
}

/**
 * 展开的命令列表 - 作为输入框的内嵌部分
 */
export const ExpandedCommandList = React.memo(({
  query,
  chatContext,
  onCommandSelect,
  onClose,
  inputStateManager
}: ExpandedCommandListProps) => {
  const { getCommandSuggestions } = useSlashCommands(chatContext);
  
  const commands = useMemo(() => {
    return getCommandSuggestions(query);
  }, [getCommandSuggestions, query]);

  // 🔧 修复状态订阅循环：只监听特定状态变化，避免重复关闭
  useEffect(() => {
    if (!inputStateManager) return;

    let isClosing = false; // 防重入标志

    const unsubscribe = inputStateManager.subscribe((state) => {
      // 🚨 避免重复关闭：已在关闭过程中则忽略
      if (isClosing) return;
      
      // 🎯 只在录音状态下才自动关闭（高优先级中断）
      if (state.mode === InputMode.RECORDING && onClose) {
        isClosing = true;
        onClose();
        // 录音结束后重置标志
        setTimeout(() => { isClosing = false; }, 100);
      }
    });

    return unsubscribe;
  }, [inputStateManager, onClose]);

  // 🔧 命令选择处理：移除重复状态转换，由父组件统一处理
  const handleCommandSelect = (command: any) => {
    // 执行原有的命令选择逻辑
    onCommandSelect(command);
    
    // 🎯 不在这里调用状态转换，避免与父组件重复
    // 父组件 ChatInputBox 的 handleCommandSelect 已经处理状态转换
  };

  // 🔧 关闭按钮处理：移除重复状态转换，由父组件统一处理
  const handleClose = () => {
    if (onClose) {
      onClose();
    }
    
    // 🎯 不在这里调用状态转换，避免与父组件重复
    // 父组件 ChatInputBox 的 handleCloseCommandList 已经处理状态转换
  };
  
  if (commands.length === 0) {
    return null;
  }

  return (
    <div className="absolute left-0 right-0 bottom-full mb-2 bg-white dark:bg-gray-600 rounded-md shadow-lg z-50 animate-slideDown">
      <div className="py-1">
        <div className="px-3 py-1 text-xs text-gray-500 bg-gray-50 dark:bg-gray-700 flex items-center justify-between command-list-header">
          <span>{t('可用命令')} ({commands.length})</span>
          {onClose && (
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              aria-label="关闭命令列表"
            >
              ✕
            </button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 command-list-body">
          {commands.map((command: any, index: number) => {
            const itemCommand = {
              name: command.name,
              label: `/${command.name}`,
              description: command.description,
              type: command.type,
              category: command.category,
              scope: command.scope,
              botId: command.botId,
              botName: command.botName,
              botUserId: command.botUserId,
              handler: () => Promise.resolve({ success: true })
            };

            // 🔧 修复：生成唯一Key，避免重复命令名冲突
            const uniqueKey = command.botId 
              ? `bot_${command.botId}_${command.name}` 
              : `${command.type || 'system'}_${command.name}_${index}`;

            return (
              <div
                key={uniqueKey}
                className="command-list-item"
                onClick={() => handleCommandSelect(command)}
              >
                <SlashCommandItem command={itemCommand} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

ExpandedCommandList.displayName = 'ExpandedCommandList';
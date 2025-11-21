import React from 'react';
import { Icon } from 'tailchat-design';
import clsx from 'clsx';
import { InputMode } from '@/types/inputState';
import type { InputStateManager } from '@/types/inputState';

interface CommandMenuButtonProps {
  isOpen: boolean;
  onClick: () => void;
  className?: string;
  inputStateManager?: InputStateManager;
}

/**
 * 命令列表菜单按钮 - Telegram 风格
 * 当列表打开时显示 X，关闭时显示 ☰
 */
function CommandMenuButtonInner(props: CommandMenuButtonProps) {
  const { isOpen, onClick, className, inputStateManager } = props;
  
  // 检查是否可以交互 - 录音时隐藏此按钮，由父组件控制
  const canInteract = !inputStateManager?.isMode(InputMode.RECORDING);
  
  const handleClick = () => {
    if (!canInteract) return;
    
    // 🔧 只执行父组件的点击逻辑，移除重复的状态转换
    // 父组件的 toggleCommandList 已经处理了状态转换
    onClick();
    
    // 🚨 不在这里调用状态转换，避免与父组件重复
    // 原来的双重调用导致了性能问题和状态混乱
  };

  return (
    <button
      className={clsx(
        'command-menu-button',
        'flex items-center justify-center',
        'w-10 h-10 rounded-full',
        'hover:bg-gray-100 dark:hover:bg-gray-500',
        'active:scale-95',
        'focus:outline-none',
        !canInteract && 'opacity-50 cursor-not-allowed',
        className
      )}
      style={{
        transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        willChange: 'transform'
      }}
      onClick={handleClick}
      disabled={!canInteract}
      aria-label={isOpen ? '关闭命令列表' : '打开命令列表'}
      data-testid="command-menu-button"
    >
      <Icon
        icon={isOpen ? 'mdi:close' : 'mdi:menu'}
        className={clsx(
          'text-2xl',
          isOpen && 'rotate-90'
        )}
        style={{
          transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform'
        }}
      />
    </button>
  );
}

export const CommandMenuButton = React.memo(CommandMenuButtonInner);
CommandMenuButton.displayName = 'CommandMenuButton';
import React from 'react';
import { useChatInputActionContext } from './context';
import { EmojiPanel } from '@/components/Emoji';
import { BaseChatInputButton } from './BaseChatInputButton';
import { InputStateManager, InputMode, StateTransitionEvent } from '@/types/inputState';
import './Emotion.less';

interface ChatInputEmotionProps {
  inputStateManager?: InputStateManager;
}

export const ChatInputEmotion: React.FC<ChatInputEmotionProps> = React.memo(({ inputStateManager }) => {
  const actionContext = useChatInputActionContext();
  const { appendMsg } = actionContext;

  // 检查是否可以交互 - 录音时禁用交互但保持显示
  const canInteract = !inputStateManager?.isMode(InputMode.RECORDING);

  const handlePopoverOpenChange = (open: boolean) => {
    if (!inputStateManager) return;
    
    if (open) {
      // 表情面板打开时设置表情选择器模式
      inputStateManager.transition(StateTransitionEvent.OPEN_EMOJI_PICKER);
    } else {
      // 表情面板关闭时重置状态
      if (inputStateManager.isMode(InputMode.EMOJI_PICKER)) {
        inputStateManager.transition(StateTransitionEvent.CLOSE_EMOJI_PICKER);
      }
    }
  };

  const handleEmojiSelect = (code: string, hidePopover: () => void) => {
    // 插入表情
    appendMsg(code);
    hidePopover();
    
    // 表情选择后重置状态
    if (inputStateManager?.isMode(InputMode.EMOJI_PICKER)) {
      inputStateManager.transition(StateTransitionEvent.CLOSE_EMOJI_PICKER);
    }
  };

  return (
    <BaseChatInputButton
      overlayClassName="emotion-popover"
      icon="mdi:emoticon-happy-outline"
      disabled={!canInteract}
      onOpenChange={handlePopoverOpenChange}
      popoverContent={({ hidePopover }) => (
        <EmojiPanel
          onSelect={(code) => handleEmojiSelect(code, hidePopover)}
        />
      )}
    />
  );
});
ChatInputEmotion.displayName = 'ChatInputEmotion';

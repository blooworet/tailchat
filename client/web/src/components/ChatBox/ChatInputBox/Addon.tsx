import {
  getMessageTextDecorators,
  pluginChatInputActions,
} from '@/plugin/common';
import { Icon } from 'tailchat-design';
import { Dropdown, MenuProps } from 'antd';
import React, { useState, useEffect } from 'react';
import { t } from 'tailchat-shared';
import { useChatInputActionContext } from './context';
import { uploadMessageFile, uploadMessageImage } from './utils';
import clsx from 'clsx';
import type { MenuItemType } from 'antd/lib/menu/hooks/useItems';
import { openFile } from '@/utils/file-helper';
import { InputStateManager, InputMode, StateTransitionEvent } from '@/types/inputState';

interface ChatInputAddonProps {
  inputStateManager?: InputStateManager;
}

export const ChatInputAddon: React.FC<ChatInputAddonProps> = React.memo(({ inputStateManager }) => {
  const [open, setOpen] = useState(false);
  const actionContext = useChatInputActionContext();
  
  if (actionContext === null) {
    return null;
  }

  // 检查是否可以交互 - 录音和命令列表模式下禁用
  const canInteract = inputStateManager ? 
    !inputStateManager.isMode(InputMode.RECORDING) && 
    !inputStateManager.isMode(InputMode.COMMAND_LIST) : true;

  // 监听状态管理器变化，同步内部状态
  useEffect(() => {
    if (!inputStateManager) return;

    const unsubscribe = inputStateManager.subscribe((state) => {
      // 如果状态管理器不在ATTACHMENT模式，但内部状态是打开的，则关闭
      if (state.mode !== InputMode.ATTACHMENT && open) {
        setOpen(false);
      }
    });

    return unsubscribe;
  }, [inputStateManager, open]);

  // 处理下拉菜单开启/关闭
  const handleOpenChange = (newOpen: boolean) => {
    if (!canInteract && newOpen) {
      return; // 不允许交互时不允许打开
    }

    setOpen(newOpen);

    // 通知状态管理器
    if (inputStateManager) {
      if (newOpen) {
        inputStateManager.transition(StateTransitionEvent.OPEN_ATTACHMENT);
      } else {
        if (inputStateManager.isMode(InputMode.ATTACHMENT)) {
          inputStateManager.transition(StateTransitionEvent.CLOSE_ATTACHMENT);
        }
      }
    }
  };

  const handleSendImage = (file: File) => {
    // 发送图片
    const image = file;
    if (image) {
      // 发送图片
      uploadMessageImage(image).then(({ url, width, height }) => {
        actionContext.sendMsg(
          getMessageTextDecorators().image(url, { width, height })
        );
      });
    }
  };

  const handleSendFile = (file: File) => {
    // 发送文件
    if (file) {
      // 发送图片
      uploadMessageFile(file).then(({ name, url }) => {
        actionContext.sendMsg(
          getMessageTextDecorators().card(name, { type: 'file', url })
        );
      });
    }
  };

  // 菜单项点击后的通用处理
  const handleMenuItemClick = () => {
    setOpen(false);
    // 重置状态到IDLE
    if (inputStateManager && inputStateManager.isMode(InputMode.ATTACHMENT)) {
      inputStateManager.transition(StateTransitionEvent.CLOSE_ATTACHMENT);
    }
  };

  const menu: MenuProps = {
    items: [
      {
        key: 'send-image',
        label: t('发送图片'),
        onClick: async () => {
          handleMenuItemClick();
          const file = await openFile({ accept: 'image/*' });
          if (file) {
            handleSendImage(file);
          }
        },
      },
      {
        key: 'send-file',
        label: t('发送文件'),
        onClick: async () => {
          handleMenuItemClick();
          const file = await openFile();
          if (file) {
            handleSendFile(file);
          }
        },
      },
      ...pluginChatInputActions.map(
        (item, i) =>
          ({
            key: item.label + i,
            label: item.label,
            onClick: () => {
              item.onClick(actionContext);
              handleMenuItemClick();
            },
          } as MenuItemType)
      ),
    ],
  };

  return (
    <Dropdown
      menu={menu}
      open={open}
      onOpenChange={handleOpenChange}
      placement="topRight"
      trigger={canInteract ? ['click'] : []}
    >
      <div>
        <Icon
          className={clsx('text-2xl transition transform', {
            'rotate-45': open,
            'cursor-pointer': canInteract,
            'cursor-not-allowed opacity-50': !canInteract,
          })}
          icon="mdi:plus-circle-outline"
        />
      </div>
    </Dropdown>
  );
});
ChatInputAddon.displayName = 'ChatInputAddon';

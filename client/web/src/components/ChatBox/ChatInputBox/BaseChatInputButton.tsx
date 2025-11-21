import { Popover } from 'antd';
import clsx from 'clsx';
import React, { useState } from 'react';
import { Icon } from 'tailchat-design';
import './BaseChatInputButton.less';

interface BaseChatInputButtonProps {
  overlayClassName?: string;
  icon: string;
  popoverContent: (ctx: { hidePopover: () => void }) => JSX.Element;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}
export const BaseChatInputButton =
  React.memo((props: BaseChatInputButtonProps) => {
    const [visible, setVisible] = useState(false);

    const handleOpenChange = (open: boolean) => {
      setVisible(open);
      props.onOpenChange?.(open);
    };

    return (
      <Popover
        visible={visible}
        onVisibleChange={handleOpenChange}
        // 兼容新旧API
        onOpenChange={handleOpenChange}
        content={() =>
          props.popoverContent({
            hidePopover: () => {
              setVisible(false);
              props.onOpenChange?.(false);
            },
          })
        }
        overlayClassName={clsx(
          'chat-message-input_action-popover',
          props.overlayClassName
        )}
        showArrow={false}
        placement="topRight"
        trigger={props.disabled ? [] : ['click']}
      >
        <span
          className={clsx(
            'inline-flex items-center justify-center',
            props.disabled ? 'text-gray-300 cursor-not-allowed' : 'cursor-pointer'
          )}
          role="button"
          aria-disabled={props.disabled}
        >
          <Icon className="text-2xl" icon={props.icon} />
        </span>
      </Popover>
    );
  });
BaseChatInputButton.displayName = 'BaseChatInputButton';

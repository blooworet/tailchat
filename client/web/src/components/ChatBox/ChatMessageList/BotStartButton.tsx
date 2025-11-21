import React from 'react';
import { Button } from 'antd';
import { t } from 'tailchat-shared';

interface BotStartButtonProps {
  onSendStart: () => void;
}

/**
 * 机器人START按钮 - Telegram风格
 * 显示在输入框位置，点击后发送 /start 命令
 */
export const BotStartButton: React.FC<BotStartButtonProps> = React.memo(
  (props) => {
    const { onSendStart } = props;

    return (
      <div className="w-full px-4 py-3">
        <div className="flex items-center justify-center">
          <Button
            type="primary"
            size="large"
            className="rounded-full px-16 h-12 font-medium text-base shadow-md hover:shadow-lg transition-all"
            onClick={onSendStart}
          >
            {t('START')}
          </Button>
        </div>
      </div>
    );
  }
);
BotStartButton.displayName = 'BotStartButton';


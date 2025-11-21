import React, { useState } from 'react';
import { Button, message } from 'antd';
import { Icon } from 'tailchat-design';
import { 
  addFriendRequest,
  showErrorToasts, 
  showSuccessToasts,
  useUserInfoList,
  t
} from 'tailchat-shared';
// 样式已内联，无需外部样式文件

interface FriendRequestBarProps {
  /** 不是好友的用户ID列表 */
  nonFriendUserIds: string[];
  /** 是否显示悬浮栏 */
  visible: boolean;
  /** 关闭悬浮栏的回调 */
  onClose?: () => void;
}

/**
 * 好友申请悬浮栏组件
 * 用于在DM聊天中向非好友用户发送好友申请
 */
export const FriendRequestBar: React.FC<FriendRequestBarProps> = React.memo((props) => {
  const { nonFriendUserIds, visible, onClose } = props;
  const [loading, setLoading] = useState(false);
  const [sentUserIds, setSentUserIds] = useState<string[]>([]);
  
  // 获取非好友用户的信息
  const nonFriendUsers = useUserInfoList(nonFriendUserIds);
  const [isCloseButtonHovered, setIsCloseButtonHovered] = useState(false);
  const [isPrimaryButtonHovered, setIsPrimaryButtonHovered] = useState(false);
  
  if (!visible || nonFriendUserIds.length === 0) {
    return null;
  }

  const handleSendFriendRequest = async (userId: string) => {
    try {
      setLoading(true);
      await addFriendRequest(userId);
      setSentUserIds(prev => [...prev, userId]);
      showSuccessToasts(t('已发送申请'));
    } catch (error: any) {
      const errorMessage = String(error?.message || error);
      
      // 直接显示服务器返回的错误信息
      message.error(errorMessage);
      console.error('发送好友申请失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendAllRequests = async () => {
    try {
      setLoading(true);
      const unsentUserIds = nonFriendUserIds.filter(id => !sentUserIds.includes(id));
      const successUserIds: string[] = [];
      const errorMessages: string[] = [];
      
      for (const userId of unsentUserIds) {
        try {
          await addFriendRequest(userId);
          successUserIds.push(userId);
        } catch (error: any) {
          const errorMessage = String(error?.message || error);
          errorMessages.push(errorMessage);
          console.error(`发送给用户 ${userId} 的好友申请失败:`, error);
        }
      }
      
      setSentUserIds(prev => [...prev, ...successUserIds]);
      
      if (errorMessages.length > 0) {
        // 显示所有错误信息
        errorMessages.forEach(msg => message.error(msg));
      }
      
      if (successUserIds.length > 0) {
        showSuccessToasts(t('已发送申请'));
      }
    } catch (error) {
      const errorMessage = String((error as any)?.message || error);
      message.error(errorMessage);
      console.error('批量发送好友申请失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 获取第一个非好友用户的昵称
  const firstNonFriendUser = nonFriendUsers[0];
  const displayName = firstNonFriendUser?.nickname || firstNonFriendUser?.username || t('用户');
  
  // 内联样式，根据主题动态调整
  // 使用 Design Tokens（CSS 变量）驱动样式
  const bannerVars = {
    background: 'var(--tc-banner-bg)',
    borderColor: 'var(--tc-banner-border)',
    iconBg: 'var(--tc-banner-icon-bg)',
    iconColor: 'var(--tc-banner-icon-color)',
    titleColor: 'var(--tc-banner-title-color)',
    subtitleColor: 'var(--tc-banner-subtitle-color)',
    buttonBg: 'var(--tc-banner-button-bg)',
    closeButtonHoverBg: 'var(--tc-banner-close-hover-bg)'
  } as const;

  // Telegram 主题不需要特殊样式，保持简洁

  return (
    <div 
      className="px-4 py-3 border-b"
      style={{
        background: bannerVars.background,
        borderColor: bannerVars.borderColor,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div 
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
            style={{ backgroundColor: bannerVars.iconBg }}
          >
            <Icon 
              icon="mdi:account-plus" 
              className="text-base"
              style={{ color: bannerVars.iconColor }}
            />
          </div>
          <div className="flex-1">
            <div 
              className="text-sm font-medium"
              style={{ color: bannerVars.titleColor }}
            >
              {nonFriendUserIds.length === 1 
                ? t('{{name}} 还不是你的好友', { name: displayName })
                : t('对话中有 {{count}} 位用户还不是你的好友', { count: nonFriendUserIds.length })
              }
            </div>
            <div 
              className="text-xs mt-1"
              style={{ color: bannerVars.subtitleColor }}
            >
              {t('发送好友申请以便更好地交流')}
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          {nonFriendUserIds.length === 1 ? (
            <Button
              type="primary"
              size="small"
              loading={loading}
              disabled={sentUserIds.includes(nonFriendUserIds[0])}
              onClick={() => handleSendFriendRequest(nonFriendUserIds[0])}
              className="shadow-sm"
              style={{
                backgroundColor: bannerVars.buttonBg,
                borderColor: bannerVars.buttonBg,
              }}
            >
              {sentUserIds.includes(nonFriendUserIds[0]) ? t('已发送') : t('添加好友')}
            </Button>
          ) : (
            <>
              <Button
                type="primary"
                size="small"
                loading={loading}
                disabled={sentUserIds.length === nonFriendUserIds.length}
                onClick={handleSendAllRequests}
                className="shadow-sm"
                style={{
                  backgroundColor: bannerVars.buttonBg,
                  borderColor: bannerVars.buttonBg,
                }}
              >
                {sentUserIds.length === nonFriendUserIds.length ? t('已全部发送') : t('全部添加')}
              </Button>
            </>
          )}
          
          {onClose && (
            <Button
              type="text"
              size="small"
              icon={<Icon icon="mdi:close" />}
              onClick={onClose}
              className="transition-colors"
              style={{ 
                color: bannerVars.subtitleColor,
                backgroundColor: isCloseButtonHovered ? bannerVars.closeButtonHoverBg : 'transparent',
              }}
              onMouseEnter={() => setIsCloseButtonHovered(true)}
              onMouseLeave={() => setIsCloseButtonHovered(false)}
            />
          )}
        </div>
      </div>
      
      {/* 显示已发送状态的用户列表 */}
      {sentUserIds.length > 0 && nonFriendUserIds.length > 1 && (
        <div 
          className="mt-3 pt-2"
          style={{ borderTop: `1px solid var(--tc-banner-border)` }}
        >
          <div 
            className="text-xs flex items-center"
            style={{ color: bannerVars.subtitleColor }}
          >
            <Icon 
              icon="mdi:check-circle" 
              className="mr-1 text-sm"
              style={{ color: bannerVars.iconColor }}
            />
            {t('已向 {{count}} 位用户发送好友申请', { count: sentUserIds.length })}
          </div>
        </div>
      )}
    </div>
  );
});

FriendRequestBar.displayName = 'FriendRequestBar';

import React from 'react';
import { Button } from 'antd';
import { Icon } from 'tailchat-design';
import { ModalWrapper } from '@/components/Modal';
import { closeModal, openModal } from '@/components/Modal';
import { CreateGroupInvite } from '@/components/modals/CreateGroupInvite';
import { InviteFriendToGroup } from '@/components/modals/InviteFriendToGroup';
// @ts-ignore - 临时忽略类型错误
import { useAppSelector } from 'tailchat-shared';
import { useInviteTranslations } from '@/utils/inviteTranslations';

interface InviteMethodSelectorProps {
  groupId: string;
}

export const InviteMethodSelector: React.FC<InviteMethodSelectorProps> = React.memo(
  ({ groupId }) => {
    // 真实获取好友数据
    // @ts-ignore - 临时忽略类型错误
    const friends = useAppSelector((state: any) => state.user.friends || []);
    const translations = useInviteTranslations();

    const handleInviteLink = () => {
      closeModal();
      openModal(<CreateGroupInvite groupId={groupId} />);
    };

    const handleInviteFriend = () => {
      closeModal();
      openModal(<InviteFriendToGroup groupId={groupId} />);
    };

    return (
      <ModalWrapper title={translations.selectInvitationMethod} style={{ width: 400 }}>
        <div className="space-y-4">
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-3 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
              <Icon className="text-3xl text-blue-600 dark:text-blue-400" icon="mdi:account-multiple-plus" />
            </div>
            <p className="text-gray-600 dark:text-gray-300 text-sm">
              {translations.chooseInvitationMethodDesc}
            </p>
          </div>

          <Button
            block
            size="large"
            type="primary"
            icon={<Icon icon="mdi:link" />}
            onClick={handleInviteLink}
            className="h-14 flex items-center justify-start"
          >
            <div className="flex items-center w-full">
              <div className="flex-1 text-left ml-2">
                <div className="font-medium text-base">{translations.createInvitationLink}</div>
                <div className="text-xs opacity-90 mt-0.5">{translations.generateInvitationLinkDesc}</div>
              </div>
            </div>
          </Button>

          {friends.length > 0 && (
            <Button
              block
              size="large"
              type="default"
              icon={<Icon icon="mdi:account-plus" />}
              onClick={handleInviteFriend}
              className="h-14 flex items-center justify-start border-2 border-gray-200 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
            >
              <div className="flex items-center w-full">
                <div className="flex-1 text-left ml-2">
                  <div className="font-medium text-base text-gray-700 dark:text-gray-200">{translations.inviteFriends}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {translations.selectFromFriendsList(friends.length)}
                  </div>
                </div>
              </div>
            </Button>
          )}

          <div className="pt-4 border-t border-gray-100 dark:border-gray-700">
            <Button 
              block 
              size="large"
              onClick={() => closeModal()}
              className="h-10 text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100"
            >
              {translations.cancel}
            </Button>
          </div>
        </div>
      </ModalWrapper>
    );
  }
);

InviteMethodSelector.displayName = 'InviteMethodSelector';

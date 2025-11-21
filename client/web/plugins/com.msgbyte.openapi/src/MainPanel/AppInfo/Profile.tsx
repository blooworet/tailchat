import { useOpenAppInfo } from '../context';
import React from 'react';
import {
  FullModalField,
  Divider,
  SensitiveText,
  Button,
  Avatar,
  AvatarUploader,
  DefaultFullModalInputEditorRender,
} from '@capital/component';
import { Translate } from '../../translate';
import { useOpenAppAction } from './useOpenAppAction';
import { formatBotUsername } from '../../utils/botUsernameValidator';
import styled from 'styled-components';
import './Profile.less';

const TwoColumnContainer = styled.div`
  display: flex;

  > div {
    flex: 1;
  }
`;

/**
 * 基础信息
 */
const Profile: React.FC = React.memo(() => {
  const { appId, appSecret, appName, appDesc, appIcon, bot, capability } = useOpenAppInfo();

  const { handleSetAppInfo, handleDeleteApp } = useOpenAppAction();

  return (
    <div className="plugin-openapi-app-info_profile">
      <h2>{Translate.app.basicInfo}</h2>

      <TwoColumnContainer>
        <div>
          <FullModalField
            title={Translate.app.appName}
            value={appName}
            editable={true}
            renderEditor={DefaultFullModalInputEditorRender}
            onSave={(val) => handleSetAppInfo('appName', val)}
          />

          <FullModalField
            title={Translate.app.appDesc}
            value={appDesc}
            editable={true}
            renderEditor={DefaultFullModalInputEditorRender}
            onSave={(val) => handleSetAppInfo('appDesc', val)}
          />

          {capability?.includes('bot') && (
            <FullModalField
              title={Translate.botUsername}
              content={
                bot?.username ? (
                  <span className="font-mono text-sm">
                    {formatBotUsername(bot.username)}
                  </span>
                ) : (
                  <span className="text-gray-500 text-sm">{Translate.botUsernameNotSet}</span>
                )
              }
            />
          )}
        </div>

        <div>
          <AvatarUploader
            onUploadSuccess={(fileInfo) => {
              handleSetAppInfo('appIcon', fileInfo.url);
            }}
          >
            <Avatar name={appName} src={appIcon} size={72} />
          </AvatarUploader>
        </div>
      </TwoColumnContainer>

      <Divider />

      <h2>{Translate.app.appcret}</h2>

      <div>
        {appId && (
          <FullModalField
            title="App ID"
            content={<span className="font-mono text-sm">{appId}</span>}
          />
        )}
        <FullModalField
          title={Translate.appSecret}
          content={<SensitiveText text={appSecret} />}
        />
      </div>

      <Divider />

      <Button type="primary" danger={true} onClick={handleDeleteApp}>
        {Translate.delete}
      </Button>
    </div>
  );
});
Profile.displayName = 'Profile';

export default Profile;

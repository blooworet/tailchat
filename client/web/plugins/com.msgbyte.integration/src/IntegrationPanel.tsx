import React, { useState } from 'react';
import { Avatar, Button, Input, UserName } from '@capital/component';
import styled from 'styled-components';
import type { OpenAppInfo } from './types';
import {
  useAsyncRequest,
  postRequest,
  showErrorToasts,
  useGroupIdContext,
  showSuccessToasts,
  emitGlobalSocketEvent,
} from '@capital/common';
import { Translate } from './translate';

interface BotUserInfo {
  _id: string;
  email: string;
  nickname: string;
  avatar: string;
  username: string;
  type: string;
}

const Tip = styled.div`
  color: #999;
  margin-bottom: 10px;
`;

const Row = styled.div`
  display: flex;
`;

const AppInfoCard = styled.div({
  backgroundColor: 'rgba(0, 0, 0, 0.1)',
  borderRadius: 3,
  padding: 10,
  marginTop: 10,

  '.app-info': {
    flex: 1,
    marginLeft: 10,

    '.title': {
      fontSize: 18,
      fontWeight: 'bold',
    },

    '.action': {
      marginTop: 10,
    },
  },
});

const BotInfoCard = styled.div({
  backgroundColor: 'rgba(0, 0, 0, 0.1)',
  borderRadius: 3,
  padding: 10,
  marginTop: 10,

  '.bot-info': {
    flex: 1,
    marginLeft: 10,

    '.name': {
      fontSize: 16,
      fontWeight: 'bold',
    },

    '.username': {
      color: '#666',
      fontSize: 14,
      marginTop: 2,
    },

    '.type': {
      color: '#999',
      fontSize: 12,
      marginTop: 2,
    },

    '.action': {
      marginTop: 10,
    },
  },
});

const MethodSelector = styled.div({
  marginBottom: 15,
  
  '.method-title': {
    marginBottom: 8,
    fontWeight: 'bold',
  },

  '.method-buttons': {
    display: 'flex',
    gap: 8,
  },
});

const IntegrationPanel: React.FC = React.memo(() => {
  const [integrationMethod, setIntegrationMethod] = useState<'appId' | 'username'>('appId');
  const [appId, setAppId] = useState('');
  const [username, setUsername] = useState('');
  const [openAppInfo, setOpenAppInfo] = useState<OpenAppInfo | null>(null);
  const [botUserInfo, setBotUserInfo] = useState<BotUserInfo | null>(null);
  const groupId = useGroupIdContext();

  const [{ loading }, handleQueryApp] = useAsyncRequest(async () => {
    const { data } = await postRequest('/openapi/app/get', {
      appId,
    });

    if (!data) {
      showErrorToasts(Translate.notFoundApp);
      return;
    }

    setOpenAppInfo(data);
    setBotUserInfo(null); // 清除机器人信息
  }, [appId]);

  const [{ loading: searchBotLoading }, handleSearchBot] = useAsyncRequest(async () => {
    // 通过 WS 查询机器人（使用宿主提供的 socket 桥接）
    const data = (await emitGlobalSocketEvent('user.findBotByUsername', { username })) as BotUserInfo;

    if (!data) {
      showErrorToasts(Translate.notFoundBot);
      return;
    }

    setBotUserInfo(data);
    setOpenAppInfo(null); // 清除应用信息
  }, [username]);

  const [{ loading: addBotLoading }, handleAddBotIntoGroup] =
    useAsyncRequest(async () => {
      if (integrationMethod === 'appId') {
        await emitGlobalSocketEvent('openapi.integration.addBotUser', {
          appId,
          groupId,
        });
      } else {
        await emitGlobalSocketEvent('openapi.integration.addBotUserByUsername', {
          username,
          groupId,
        });
      }
      showSuccessToasts();
    }, [integrationMethod, appId, username, groupId]);

  return (
    <div>
      <Tip>{Translate.onlyAllowManualAddition}</Tip>

      <MethodSelector>
        <div className="method-title">{Translate.integrationMethod}</div>
        <div className="method-buttons">
          <Button
            type={integrationMethod === 'appId' ? 'primary' : 'default'}
            onClick={() => {
              setIntegrationMethod('appId');
              // 清除之前的搜索结果
              setOpenAppInfo(null);
              setBotUserInfo(null);
            }}
          >
            {Translate.byAppId}
          </Button>
          <Button
            type={integrationMethod === 'username' ? 'primary' : 'default'}
            onClick={() => {
              setIntegrationMethod('username');
              // 清除之前的搜索结果
              setOpenAppInfo(null);
              setBotUserInfo(null);
            }}
          >
            {Translate.byUsername}
          </Button>
        </div>
      </MethodSelector>

      {integrationMethod === 'appId' ? (
        <Row>
          <Input
            placeholder={Translate.appId}
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
          />
          <Button
            type="primary"
            disabled={!appId}
            loading={loading}
            onClick={handleQueryApp}
          >
            {Translate.search}
          </Button>
        </Row>
      ) : (
        <Row>
          <Input
            placeholder={Translate.botUsername}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Button
            type="primary"
            disabled={!username}
            loading={searchBotLoading}
            onClick={handleSearchBot}
          >
            {Translate.searchBot}
          </Button>
        </Row>
      )}

      {openAppInfo && (
        <div>
          <AppInfoCard>
            <Row>
              <Avatar
                size={56}
                src={openAppInfo.appIcon}
                name={openAppInfo.appName}
              />

              <div className="app-info">
                <div>{openAppInfo.appName}</div>
                <div>{openAppInfo.appDesc}</div>
                <Row>
                  <div>{Translate.developer}:</div>
                  <UserName userId={openAppInfo.owner} />
                </Row>

                <div className="action">
                  {openAppInfo.capability.includes('bot') ? (
                    openAppInfo.bot?.allowGroup !== false ? (
                      <Button
                        type="primary"
                        size="small"
                        loading={addBotLoading}
                        onClick={handleAddBotIntoGroup}
                      >
                        {Translate.addBot}
                      </Button>
                    ) : (
                      <Button type="primary" size="small" disabled={true}>
                        {Translate.botPrivateChatOnly || '该机器人仅限私聊'}
                      </Button>
                    )
                  ) : (
                    <Button type="primary" size="small" disabled={true}>
                      {Translate.cannotAddBot}
                    </Button>
                  )}
                </div>
              </div>
            </Row>
          </AppInfoCard>
        </div>
      )}

      {botUserInfo && (
        <div>
          <BotInfoCard>
            <Row>
              <Avatar
                size={56}
                src={botUserInfo.avatar}
                name={botUserInfo.nickname}
              />

              <div className="bot-info">
                <div className="name">{botUserInfo.nickname}</div>
                <div className="username">@{botUserInfo.username}</div>
                <div className="type">
                  {botUserInfo.type === 'openapiBot' ? 'OpenAPI 机器人' : '插件机器人'}
                </div>

                <div className="action">
                  <Button
                    type="primary"
                    size="small"
                    loading={addBotLoading}
                    onClick={handleAddBotIntoGroup}
                  >
                    {Translate.addBotByUsername}
                  </Button>
                </div>
              </div>
            </Row>
          </BotInfoCard>
        </div>
      )}
    </div>
  );
});
IntegrationPanel.displayName = 'IntegrationPanel';

export default IntegrationPanel;

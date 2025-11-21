import React, { useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  useAsync, 
  createSocket,
  getGlobalSocket,
  createDMConverse, 
  showErrorToasts, 
  showSuccessToasts, 
  t,
  getGlobalConfig,
  checkTokenValid,
  request,
} from 'tailchat-shared';
import { getUserJWT } from '@/utils/jwt-helper';

import { UserProfileContainer } from '../../components/UserProfileContainer';
import { Button, Space, Tag, Typography } from 'antd';
import { usePluginUserExtraInfo } from '../../components/popover/UserPopover/usePluginUserExtraInfo';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import LogoSvgUrl from '../../../assets/images/logo.svg';
const { Text } = Typography;

/**
 * 用户个人页面 - Telegram 风格
 */
export const UserProfilePage: React.FC = React.memo(() => {
  const { username } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const startHandledRef = useRef(false);

  // 获取全局配置中的服务器名称
  const globalConfig = getGlobalConfig();
  const serverName = globalConfig.serverName || 'Tailchat';

  const { loading, value: userData, error } = useAsync(async () => {
    if (!username) {
      return null;
    }

    try {
      const encodedUsername = encodeURIComponent(username);
      const res = await request.get(`/api/user/public/${encodedUsername}`);
      return res?.data ?? null;
    } catch (err) {
      console.error('获取用户信息失败:', err);
      return null;
    }
  }, [username]);

  const userInfo = userData || {};
  const pluginUserExtraInfoEl = usePluginUserExtraInfo(userInfo.extra ?? {});

  const userNotFound = !loading && (!userData || error);

  // Handle deep link: /:username?start=<payload>
  useEffect(() => {
    if (startHandledRef.current) return;
    if (loading) return;
    if (!userInfo || !userInfo._id) return;

    // parse payload
    const params = new URLSearchParams(location.search);
    const payload = params.get('start');
    if (!payload) return;

    // only for bot users
    const isBot = userInfo.type === 'pluginBot' || userInfo.type === 'openapiBot';
    if (!isBot) return;

    const run = async () => {
      try {
        // ensure login
        const token = await getUserJWT();
        const ok = token ? await checkTokenValid(token) : false;
        if (!ok) {
          showErrorToasts(t('尚未登录, 立即登录'));
          const redirect = encodeURIComponent(location.pathname + location.search);
          navigate(`/entry/login?redirect=${redirect}`);
          return;
        }

        let socket = getGlobalSocket();
        if (!socket || !socket.connected) {
          socket = await createSocket();
        }

        const res = await socket.request<any>('chat.converse.startBotDM', {
          botUserId: userInfo._id,
          payload: payload,
        });
        const converseId = res?.converseId;
        if (converseId) {
          startHandledRef.current = true;
          navigate(`/main/personal/converse/${converseId}`);
        }
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.includes('Unauthorized')) {
          const redirect = encodeURIComponent(location.pathname + location.search);
          navigate(`/entry/login?redirect=${redirect}`);
          return;
        }
        showErrorToasts(t('操作失败，请稍后重试'));
      }
    };

    run();
  }, [loading, userInfo, location.search]);

  const handleStartChat = async () => {
    if (!userInfo._id) {
      showErrorToasts(t('用户信息不完整，无法发送消息'));
      return;
    }

    try {
      if (userInfo.type === 'pluginBot' || userInfo.type === 'openapiBot') {
        // 机器人用户改为通过 WS 调用
        let socket = getGlobalSocket();
        if (!socket || !socket.connected) {
          socket = await createSocket();
        }
        const { converseId } = await socket.request<any>('chat.converse.startBotDM', {
          botUserId: userInfo._id,
        });
        if (!converseId) {
          throw new Error('No converseId');
        }
        showSuccessToasts(t('已开始与机器人对话'));
        navigate(`/main/personal/converse/${converseId}`);
      } else {
        // 普通用户使用 createDMConverse
        const converse = await createDMConverse([userInfo._id]);
        navigate(`/main/personal/converse/${converse._id}`);
      }
    } catch (e: any) {
      // 根据错误类型显示不同的提示信息
      const errorMessage = String(e?.message || e);
      const errorCode = e?.code || e?.response?.status;
      
      if (errorCode === 401 || errorMessage.includes('Unauthorized') || errorMessage.includes('Invalid Token')) {
        // 未登录或token无效，跳转到登录页面并携带重定向参数
        showErrorToasts(t('尚未登录, 立即登录'));
        const currentPath = encodeURIComponent(window.location.pathname);
        navigate(`/entry/login?redirect=${currentPath}`);
      } else if (errorMessage.includes('好友') || errorMessage.includes('friend')) {
        showErrorToasts(t('无法发送消息，可能需要先添加为好友'));
      } else if (errorMessage.includes('权限') || errorMessage.includes('permission')) {
        showErrorToasts(t('没有权限与此用户对话'));
      } else {
        // 显示后端返回的具体错误信息；若为空再回退到通用提示
        showErrorToasts(errorMessage || t('发送消息失败，请稍后重试'));
      }
      console.error('创建对话失败:', e);
    }
  };



  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black relative overflow-hidden">
      {/* 装饰背景 */}
      <div className="absolute inset-0 opacity-5">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(45deg, transparent 24%, rgba(68, 68, 68, .05) 25%, rgba(68, 68, 68, .05) 26%, transparent 27%, transparent 74%, rgba(68, 68, 68, .05) 75%, rgba(68, 68, 68, .05) 76%, transparent 77%, transparent),
              linear-gradient(45deg, transparent 24%, rgba(68, 68, 68, .05) 25%, rgba(68, 68, 68, .05) 26%, transparent 27%, transparent 74%, rgba(68, 68, 68, .05) 75%, rgba(68, 68, 68, .05) 76%, transparent 77%, transparent)
            `,
            backgroundSize: '50px 50px',
            backgroundPosition: '0 0, 25px 25px',
          }}
        />
      </div>

      {/* 顶部导航栏 */}
      <div className="fixed top-0 left-0 right-0 bg-black/80 backdrop-blur-sm border-b border-gray-700 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => navigate('/')}>
            <div className="w-8 h-8 text-blue-400">
              <img src={LogoSvgUrl} alt="Logo" style={{ width: '100%', height: '100%', filter: 'brightness(0) saturate(100%) invert(71%) sepia(88%) saturate(1103%) hue-rotate(194deg) brightness(106%) contrast(95%)' }} />
            </div>
            <span className="text-white font-semibold text-lg">{serverName}</span>
          </div>
          <Button 
            type="primary"
            className="rounded-full px-6"
            onClick={() => navigate('/main/personal')}
          >
            {t('Back to Personal Center')}
          </Button>
        </div>
      </div>

      {/* 主容器 */}
      <div className="pt-32 pb-8 px-4 relative z-10 min-h-screen">
        <div className="w-full max-w-sm mx-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20">
              <LoadingSpinner />
              <div className="mt-4 text-white/60 text-sm">{t('加载中...')}</div>
            </div>
          )}

          {userNotFound && (
            <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-700/50 shadow-2xl overflow-hidden">
              <div className="bg-inherit text-center p-8">
                {/* 未知用户头像占位 */}
                <div className="flex justify-center mb-6">
                  <div className="w-32 h-32 bg-gray-600 rounded-full flex items-center justify-center">
                    <span className="text-4xl text-gray-400">?</span>
                  </div>
                </div>
                
                {/* 用户名信息 */}
                <div className="text-center mb-8">
                  <div className="text-3xl font-bold text-white mb-2">
                    {t('User Not Found')}
                  </div>
                  {username && (
                    <div className="text-gray-300 text-base font-medium">@{username}</div>
                  )}
                </div>

                <div className="text-gray-400 mb-8 text-sm">{t('This username does not exist or has been deleted')}</div>
                
                {/* 禁用的发送消息按钮 */}
                <div className="flex justify-center mb-8">
                  <Button 
                    size="large"
                    disabled
                    className="rounded-full px-12 py-3 h-14 font-medium text-base"
                  >
                    {t('发送消息')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!loading && userInfo._id && (
            <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-md rounded-2xl border border-gray-700/50 shadow-2xl overflow-hidden">
              <UserProfileContainer userInfo={userInfo}>
                {/* 用户名信息 */}
                <div className="text-center mb-8">
                  <div className="text-3xl font-bold text-white mb-2">
                    {userInfo.nickname || userInfo.username || userInfo._id}
                  </div>
                  {userInfo.username && (
                    <div className="text-gray-300 text-base font-medium">@{userInfo.username}</div>
                  )}
                </div>

                {/* 标签区域 */}
                {(userInfo.type || userInfo.temporary) && (
                  <div className="flex flex-wrap justify-center gap-2 mb-8">
                    <Space size={4} wrap={true}>
                      {userInfo.type === 'openapiBot' && (
                        <Tag color="orange" className="rounded-full">{t('Open Platform Bot')}</Tag>
                      )}

                      {userInfo.type === 'pluginBot' && (
                        <Tag color="orange" className="rounded-full">{t('Plugin Bot')}</Tag>
                      )}

                      {userInfo.temporary && <Tag color="processing" className="rounded-full">{t('Guest')}</Tag>}
                    </Space>
                  </div>
                )}


                {/* 发送消息按钮 */}
                <div className="flex justify-center mb-8">
                  <Button 
                    type="primary"
                    size="large"
                    className="rounded-full px-12 py-3 h-14 font-medium text-base"
                    onClick={handleStartChat}
                  >
                    {t('发送消息')}
                  </Button>
                </div>

                {/* 额外信息区域 */}
                {pluginUserExtraInfoEl && (
                  <div className="pt-4 border-t border-gray-700/50 mt-6">
                    <div className="font-medium mb-3 text-white/80 text-sm uppercase tracking-wide">
                      {t('Additional Info')}
                    </div>
                    <div className="text-white/70 text-sm">
                      {pluginUserExtraInfoEl}
                    </div>
                  </div>
                )}
              </UserProfileContainer>
            </div>
          )}
        </div>
      </div>

      {/* 底部装饰 */}
      <div className="fixed bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
    </div>
  );
});
UserProfilePage.displayName = 'UserProfilePage';

export default UserProfilePage;
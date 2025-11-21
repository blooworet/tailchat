import {
  createSocket,
  setupRedux,
  useAsync,
  userActions,
  t,
  ReduxProvider,
  UserLoginInfo,
  getReduxStore,
  fetchGlobalClientConfig,
  isProduction,
  version,
} from 'tailchat-shared';
import React, { PropsWithChildren } from 'react';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { tryAutoLogin } from '@/utils/user-helper';
import _isNil from 'lodash/isNil';
import { useNavigate } from 'react-router';
import { SidebarContextProvider } from './SidebarContext';
import { PortalHost } from '@/components/Portal';
import { setGlobalStore, setGlobalSocket } from '@/utils/global-state-helper';
import { SocketContextProvider } from '@/context/SocketContext';
import { Problem } from '@/components/Problem';
import { KeepAliveOverlayHost } from '@/components/KeepAliveOverlay';

/**
 * 应用状态管理hooks
 */
function useAppState() {
  const navigate = useNavigate();

  const { value, loading, error } = useAsync(async () => {
    let userLoginInfo: UserLoginInfo;
    try {
      userLoginInfo = await tryAutoLogin();
    } catch (e) {
      // 当前 Token 不存在或已过期
      navigate(
        `/entry/login?redirect=${encodeURIComponent(location.pathname)}`,
        { replace: true }
      );
      return;
    }

    // 到这里 userLoginInfo 必定存在
    // 创建Redux store
    const store = getReduxStore();
    store.dispatch(userActions.setUserInfo(userLoginInfo));
    setGlobalStore(store);

    // 创建 websocket 连接 - 使用shared版本的socket管理
    const socket = await createSocket(userLoginInfo.token);
    // 由于移除了TailProto加密，需要手动设置全局socket
    setGlobalSocket(socket);

    // 初始化Redux
    setupRedux(socket, store);

    // 登录后加载全局配置（含 A/B 开关）
    try {
      const config = await fetchGlobalClientConfig();
      try {
        const ab: any = (config as any)?.ab || {};
        const w: any = window as any;
        w.__TC_AB = Object.assign({}, w.__TC_AB || {}, ab);
        const overrideKeys = [
          'inline_defer',
          'keyboard_defer',
        ];
        overrideKeys.forEach((k) => {
          const v = window.localStorage.getItem(`tc_ab_${k}`);
          if (v === 'true') w.__TC_AB[k] = true;
          if (v === 'false') w.__TC_AB[k] = false;
        });
      } catch {}
    } catch (e) {
      console.error('[Provider] 全局配置加载失败', e);
    }

    return { store, socket };
  }, []);

  const store = value?.store;
  const socket = value?.socket;

  return { loading, store, socket, error };
}

/**
 * 主页面核心数据Provider
 * 在主页存在
 */
export const MainProvider: React.FC<PropsWithChildren> = React.memo((props) => {
  const { loading, store, error, socket } = useAppState();

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-content-light dark:bg-content-dark text-gray-700 dark:text-white text-xl">
        <LoadingSpinner tip={t('正在连接到聊天服务器...')} />
      </div>
    );
  }

  if (error) {
    console.error('[MainProvider]', error);
    return <div>{error.message}</div>;
  }

  if (_isNil(store)) {
    return <Problem text={t('出现异常, Store 创建失败')} />;
  }

  if (_isNil(socket)) {
    return <Problem text={t('出现异常, Socket 创建失败')} />;
  }

  return (
    <ReduxProvider store={store}>
      <SocketContextProvider socket={socket}>
        <SidebarContextProvider>
          <KeepAliveOverlayHost>
            <PortalHost>{props.children}</PortalHost>
          </KeepAliveOverlayHost>
        </SidebarContextProvider>
      </SocketContextProvider>
    </ReduxProvider>
  );
});
MainProvider.displayName = 'MainProvider';

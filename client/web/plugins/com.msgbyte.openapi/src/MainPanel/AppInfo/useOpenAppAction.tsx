import {
  openReconfirmModal,
  postRequest,
  showErrorToasts,
  useAsyncFn,
  useAsyncRequest,
  useEvent,
} from '@capital/common';
import { emitGlobalSocketEvent } from '@capital/common';
import { useOpenAppInfo } from '../context';
import type { OpenAppBot, OpenAppCapability, OpenAppOAuth } from '../types';

/**
 * 开放应用操作
 */
export function useOpenAppAction() {
  const { refresh, appId, capability, onSelectApp } = useOpenAppInfo();

  const [{ loading }, handleChangeAppCapability] = useAsyncRequest(
    async (targetCapability: OpenAppCapability, checked: boolean) => {
      const newCapability: OpenAppCapability[] = [...capability];
      const findIndex = newCapability.findIndex((c) => c === targetCapability);

      if (checked) {
        if (findIndex === -1) {
          newCapability.push(targetCapability);
        }
      } else {
        if (findIndex !== -1) {
          newCapability.splice(findIndex, 1);
        }
      }
      // WS 调用（通过宿主提供的桥接）
      await emitGlobalSocketEvent('openapi.app.setAppCapability', {
        appId,
        capability: newCapability,
      });
      await refresh();
    },
    [appId, capability, refresh]
  );

  const [, handleSetAppInfo] = useAsyncRequest(
    async (fieldName: string, fieldValue: string) => {
      await emitGlobalSocketEvent('openapi.app.setAppInfo', {
        appId,
        fieldName,
        fieldValue,
      });
      await refresh();
    },
    [appId, refresh]
  );

  const [, handleUpdateOAuthInfo] = useAsyncRequest(
    async <T extends keyof OpenAppOAuth>(name: T, value: OpenAppOAuth[T]) => {
      await emitGlobalSocketEvent('openapi.app.setAppOAuthInfo', {
        appId,
        fieldName: name,
        fieldValue: value,
      });
      await refresh();
    },
    []
  );

  const [, handleUpdateBotInfo] = useAsyncRequest(
    async <T extends keyof OpenAppBot>(name: T, value: OpenAppBot[T]) => {
      // 改为通过 WebSocket 调用
      await emitGlobalSocketEvent('openapi.app.setAppBotInfo', {
        appId,
        fieldName: name,
        fieldValue: value,
      });
      await refresh();
    },
    [appId, refresh]
  );


  const handleDeleteApp = useEvent(() => {
    openReconfirmModal({
      onConfirm: async () => {
        try {
          await emitGlobalSocketEvent('openapi.app.delete', { appId });
          onSelectApp(null);
          await refresh();
        } catch (err) {
          showErrorToasts(err);
        }
      },
    });
  });


  return {
    loading,
    handleSetAppInfo,
    handleDeleteApp,
    handleChangeAppCapability,
    handleUpdateOAuthInfo,
    handleUpdateBotInfo,
  };
}

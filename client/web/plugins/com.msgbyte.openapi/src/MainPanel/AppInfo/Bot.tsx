import React, { useState, useCallback, useEffect } from 'react';
import {
  DefaultFullModalInputEditorRender,
  FullModalField,
  Switch,
} from '@capital/component';
import { useAsyncFn } from '@capital/common';
import { Input, Button, Alert, Space, Card } from 'antd';
import { useOpenAppInfo } from '../context';
import { Translate } from '../../translate';
import { useOpenAppAction } from './useOpenAppAction';
import { 
  validateBotUsername, 
  formatBotUsername 
} from '../../utils/botUsernameValidator';

const Bot: React.FC = React.memo(() => {
  const { capability, bot, appName } = useOpenAppInfo();
  const { loading, handleChangeAppCapability, handleUpdateBotInfo } =
    useOpenAppAction();

  const [usernameInput, setUsernameInput] = useState('');
  const [usernameValidation, setUsernameValidation] = useState<{
    isValid: boolean;
    isChecking: boolean;
    error?: string;
    isAvailable?: boolean;
  }>({ isValid: true, isChecking: false });
  const [isEditingUsername, setIsEditingUsername] = useState(false);


  // 检查是否已设置用户名
  const hasUsername = Boolean(bot?.username);
  const currentUsername = bot?.username || '';

  // 检查用户名可用性的异步函数
  const [{ loading: checkingAvailability }, checkUsernameAvailability] = useAsyncFn(
    async () => {
      // 不再调用后端接口进行可用性预检，交由保存时服务端校验
      return true;
    },
    []
  );

  // 实时验证用户名
  const validateUsernameRealtime = useCallback(
    async (username: string) => {
      if (!username) {
        setUsernameValidation({
          isValid: false,
          isChecking: false,
          error: Translate.botUsernameCannotBeEmpty,
        });
        return;
      }

      // 首先验证格式
      const formatValidation = validateBotUsername(username);
      if (!formatValidation.isValid) {
        setUsernameValidation({
          isValid: false,
          isChecking: false,
          error: formatValidation.error,
        });
        return;
      }

      // 格式正确，检查可用性
      setUsernameValidation({
        isValid: false,
        isChecking: true,
      });

      try {
        const isAvailable = await checkUsernameAvailability();
        setUsernameValidation({
          isValid: isAvailable,
          isChecking: false,
          isAvailable,
          error: isAvailable ? undefined : Translate.usernameAlreadyTaken,
        });
      } catch (error) {
        setUsernameValidation({
          isValid: false,
          isChecking: false,
          error: Translate.checkUsernameError,
        });
      }
    },
    [checkUsernameAvailability]
  );

  // 防抖处理用户名输入
  useEffect(() => {
    if (!usernameInput) return;

    const timer = setTimeout(() => {
      validateUsernameRealtime(usernameInput);
    }, 500); // 500ms 防抖

    return () => clearTimeout(timer);
  }, [usernameInput, validateUsernameRealtime]);

  // 处理用户名输入变化
  const handleUsernameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUsernameInput(value);
    
    // 重置验证状态
    if (!value) {
      setUsernameValidation({
        isValid: false,
        isChecking: false,
        error: Translate.botUsernameCannotBeEmpty,
      });
    } else {
      // 输入时显示检查中状态
      setUsernameValidation({
        isValid: false,
        isChecking: false,
      });
    }
  }, []);


  // 开始编辑用户名
  const handleStartEditUsername = useCallback(() => {
    setIsEditingUsername(true);
    setUsernameInput(currentUsername); // 预填充当前用户名
  }, [currentUsername]);

  // 取消编辑用户名
  const handleCancelEditUsername = useCallback(() => {
    setIsEditingUsername(false);
    setUsernameInput('');
    setUsernameValidation({ isValid: true, isChecking: false });
  }, []);

  // 保存用户名
  const handleSaveUsername = useCallback(async () => {
    if (!usernameInput) {
      return;
    }
    
    // 最终提交前再次验证
    if (!usernameValidation.isValid || usernameValidation.isChecking) {
      return;
    }

    try {
      await handleUpdateBotInfo('username', usernameInput);
      setUsernameInput(''); // 清空输入框
      setIsEditingUsername(false); // 退出编辑模式
      // 重置验证状态
      setUsernameValidation({ isValid: true, isChecking: false });
    } catch (error) {
      console.error('Failed to set bot username:', error);
    }
  }, [usernameInput, usernameValidation, handleUpdateBotInfo]);


  return (
    <div className="plugin-openapi-app-info_bot">
      <FullModalField
        title={Translate.enableBotCapability}
        content={
          <Switch
            disabled={loading}
            checked={capability.includes('bot')}
            onChange={(checked) => handleChangeAppCapability('bot', checked)}
          />
        }
      />

      {capability.includes('bot') && (
        <>
          {/* 机器人用户名设置 */}
          <FullModalField
            title={Translate.botUsername}
            tip={Translate.botUsernameTip}
            content={
              <div className="space-y-3">
                {/* 如果已设置用户名且不在编辑模式，显示当前用户名 */}
                {hasUsername && !isEditingUsername && (
                  <>
                    <div className="text-sm">
                      <span className="font-mono">@{currentUsername}</span>
                    </div>
                  </>
                )}

                {/* 如果未设置用户名或在编辑模式，显示输入框 */}
                {(!hasUsername || isEditingUsername) && (
                  <>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        placeholder={Translate.botUsernameExampleShort}
                        value={usernameInput}
                        onChange={handleUsernameChange}
                        status={
                          !usernameValidation.isValid && usernameInput 
                            ? 'error' 
                            : undefined
                        }
                        disabled={loading}
                        addonBefore="@"
                      />
                      <Button 
                        type="primary" 
                        onClick={handleSaveUsername}
                        disabled={
                          !usernameInput || 
                          !usernameValidation.isValid || 
                          usernameValidation.isChecking || 
                          loading
                        }
                        loading={usernameValidation.isChecking}
                      >
                        {hasUsername ? '保存' : '设置'}
                      </Button>
                      {isEditingUsername && (
                        <Button 
                          onClick={handleCancelEditUsername}
                          disabled={loading}
                        >
                          取消
                        </Button>
                      )}
                    </Space.Compact>

                    {usernameValidation.isChecking && (
                      <Alert
                        message={Translate.checkingUsernameAvailability}
                        type="info"
                        showIcon
                        style={{ 
                          backgroundColor: 'rgba(24, 144, 255, 0.1)', 
                          border: '1px solid rgba(24, 144, 255, 0.3)',
                          color: 'inherit'
                        }}
                      />
                    )}

                    {!usernameValidation.isValid && usernameValidation.error && !usernameValidation.isChecking && (
                      <Alert
                        message={usernameValidation.error}
                        type="error"
                        showIcon
                        style={{ 
                          backgroundColor: 'rgba(255, 77, 79, 0.1)', 
                          border: '1px solid rgba(255, 77, 79, 0.3)',
                          color: 'inherit'
                        }}
                      />
                    )}

                    {usernameValidation.isValid && usernameInput && !usernameValidation.isChecking && (
                      <Alert
                        message={Translate.usernameAvailable}
                        type="success"
                        showIcon
                        style={{ 
                          backgroundColor: 'rgba(82, 196, 26, 0.1)', 
                          border: '1px solid rgba(82, 196, 26, 0.3)',
                          color: 'inherit'
                        }}
                      />
                    )}

                  </>
                )}
              </div>
            }
          />

          {/* 群组设置 */}
          <FullModalField
            title={Translate.bot.allowGroup || '群组设置'}
            tip={Translate.bot.allowGroupTip || '控制机器人是否可以被添加到群组中'}
            content={
              <Switch
                checked={bot?.allowGroup !== false} // 默认为true
                onChange={(checked) =>
                  handleUpdateBotInfo('allowGroup', checked)
                }
                checkedChildren={Translate.bot.allowGroupEnabled}
                unCheckedChildren={Translate.bot.allowGroupDisabled}
              />
            }
          />

          {/* 接收群内全部消息 */}
          <FullModalField
            title={Translate.bot.receiveAllGroupMessages}
            tip={Translate.bot.receiveAllGroupMessagesTip}
            content={
              <Switch
                checked={!!bot?.receiveAllGroupMessages}
                onChange={(checked) =>
                  handleUpdateBotInfo('receiveAllGroupMessages', checked)
                }
              />
            }
          />

          {/* 回调地址设置 */}
          <FullModalField
            title={Translate.bot.callback}
            tip={Translate.bot.callbackTip}
            value={bot?.callbackUrl}
            editable={true}
            renderEditor={DefaultFullModalInputEditorRender}
            onSave={(str: string) =>
              handleUpdateBotInfo('callbackUrl', String(str))
            }
          />

        </>
      )}

    </div>
  );
});
Bot.displayName = 'Bot';

export default Bot;

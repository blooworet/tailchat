import React, { useState, useCallback, useEffect } from 'react';
import { 
  Button, 
  List, 
  Tag, 
  Space, 
  Alert, 
  Modal, 
  Form, 
  Input, 
  Popconfirm,
  message,
  Select,
  Tooltip
} from 'antd';
import { useOpenAppInfo } from '../context';
import { postRequest, emitGlobalSocketEvent } from '@capital/common';
import { Translate } from '../../translate';
import type { BotCommand } from '../types';

// 辅助函数
const getScopeColor = (scopeType: string) => {
  const colorMap: Record<string, string> = {
    'default': 'green',
    'all_private_chats': 'blue',
    'all_group_chats': 'orange',
    'chat': 'purple',
    'chat_member': 'red'
  };
  return colorMap[scopeType] || 'default';
};

const getScopeLabel = (scopeType: string) => {
  const labelMap: Record<string, string> = {
    'default': Translate.bot.commands.scope.default,
    'all_private_chats': Translate.bot.commands.scope.all_private_chats,
    'all_group_chats': Translate.bot.commands.scope.all_group_chats,
    'chat': Translate.bot.commands.scope.chat,
    'chat_member': Translate.bot.commands.scope.chat_member
  };
  return labelMap[scopeType] || scopeType;
};

const BotCommands: React.FC = React.memo(() => {
  const appInfo = useOpenAppInfo();
  const bot = appInfo?.bot;
  const [loading, setLoading] = useState(false);

  // 命令管理相关状态
  const [commands, setCommands] = useState<BotCommand[]>(bot?.commands || []);
  const [isCommandModalVisible, setIsCommandModalVisible] = useState(false);
  const [editingCommand, setEditingCommand] = useState<BotCommand | null>(null);
  const [commandForm] = Form.useForm();
  const [selectedScopeType, setSelectedScopeType] = useState<string>('default');

  // 更新机器人信息的通用方法
  const handleUpdateBotInfo = useCallback(async (fieldName: string, fieldValue: any) => {
    if (!appInfo) return;

    setLoading(true);
    try {
      // 改为通过 WebSocket 调用，保持与后端 WS-only 策略一致
      await emitGlobalSocketEvent('openapi.app.setAppBotInfo', {
        appId: appInfo.appId,
        fieldName,
        fieldValue,
      });

      // 刷新应用信息
      await appInfo.refresh();


      message.success(Translate.bot.commands.updateSuccess);
    } catch (error: any) {
      console.error('Failed to update bot info:', error);
      message.error(error.message || Translate.bot.commands.updateFailed);
    } finally {
      setLoading(false);
    }
  }, [appInfo]);

  // 命令管理相关方法
  const handleAddCommand = useCallback(() => {
    setEditingCommand(null);
    commandForm.resetFields();
    setSelectedScopeType('default');
    setIsCommandModalVisible(true);
  }, [commandForm]);

  const handleEditCommand = useCallback((command: BotCommand) => {
    setEditingCommand(command);
    const scopeType = command.scope?.type || 'default';
    setSelectedScopeType(scopeType);
    
    commandForm.setFieldsValue({
      command: command.command,
      description: command.description,
      scopeType: scopeType,
      chatId: command.scope?.chat_id || '',
      userId: command.scope?.user_id || ''
    });
    setIsCommandModalVisible(true);
  }, [commandForm]);

  const handleDeleteCommand = useCallback((commandToDelete: BotCommand) => {
    const newCommands = commands.filter(cmd => cmd.command !== commandToDelete.command);
    setCommands(newCommands);
    handleUpdateBotInfo('commands', newCommands);
  }, [commands, handleUpdateBotInfo]);

  const handleSaveCommand = useCallback(async () => {
    try {
      const values = await commandForm.validateFields();
      const newCommand: BotCommand = {
        command: values.command,
        description: values.description
      };

      // 处理scope字段
      if (values.scopeType && values.scopeType !== 'default') {
        newCommand.scope = {
          type: values.scopeType
        };
        
        // 添加条件字段
        if (values.scopeType === 'chat' || values.scopeType === 'chat_member') {
          if (values.chatId) {
            newCommand.scope.chat_id = values.chatId;
          }
        }
        
        if (values.scopeType === 'chat_member') {
          if (values.userId) {
            newCommand.scope.user_id = values.userId;
          }
        }
      }

      let newCommands: BotCommand[];
      if (editingCommand) {
        // 编辑现有命令
        newCommands = commands.map(cmd => 
          cmd.command === editingCommand.command ? newCommand : cmd
        );
      } else {
        // 添加新命令
        newCommands = [...commands, newCommand];
      }

      setCommands(newCommands);
      await handleUpdateBotInfo('commands', newCommands);
      setIsCommandModalVisible(false);
    } catch (error) {
      console.error('Failed to save command:', error);
    }
  }, [commandForm, editingCommand, commands, handleUpdateBotInfo]);



  // 同步bot.commands到本地状态
  useEffect(() => {
    if (bot?.commands) {
      setCommands(bot.commands);
    }
  }, [bot?.commands]);


  if (!bot) {
    return (
      <Alert
        message={Translate.bot.commands.notEnabled}
        description={Translate.bot.commands.notEnabledDesc}
        type="warning"
        showIcon
      />
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h2>{Translate.bot.commands.title}</h2>
        <p style={{ color: '#666', marginBottom: '24px' }}>
          {Translate.bot.commands.description}
        </p>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <Space>
          <Button 
            type="primary" 
            onClick={handleAddCommand}
            disabled={loading}
          >
            {Translate.bot.commands.addCommand}
          </Button>
          
          
          <span style={{ color: '#666' }}>
            {Translate.bot.commands.commandCount.replace('{count}', commands.length.toString())}
          </span>
        </Space>
      </div>
      
      {commands.length > 0 ? (
        <List
          size="small"
          bordered
          dataSource={commands}
          renderItem={(command) => (
            <List.Item
              actions={[
                <Button
                  key="edit"
                  type="text"
                  onClick={() => handleEditCommand(command)}
                  disabled={loading}
                >
                  {Translate.bot.commands.edit}
                </Button>,
                <Popconfirm
                  key="delete"
                  title={Translate.bot.commands.deleteConfirm}
                  onConfirm={() => handleDeleteCommand(command)}
                  disabled={loading}
                >
                  <Button
                    type="text"
                    danger
                    disabled={loading}
                  >
                    {Translate.bot.commands.delete}
                  </Button>
                </Popconfirm>
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color="blue">/{command.command}</Tag>
                    <span>{command.description}</span>
                  </Space>
                }
                description={
                  <Space>
                    <Tag color={getScopeColor(command.scope?.type || 'default')}>
                      {getScopeLabel(command.scope?.type || 'default')}
                    </Tag>
                    {command.scope?.chat_id && (
                      <Tag color="orange">Chat: {command.scope.chat_id}</Tag>
                    )}
                    {command.scope?.user_id && (
                      <Tag color="purple">User: {command.scope.user_id}</Tag>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      ) : (
        <Alert
          message={Translate.bot.commands.noCommands}
          description={Translate.bot.commands.noCommandsDesc}
          type="info"
          showIcon
        />
      )}

      {/* 命令编辑弹窗 */}
      <Modal
        title={editingCommand ? Translate.bot.commands.editTitle : Translate.bot.commands.addTitle}
        open={isCommandModalVisible}
        onOk={handleSaveCommand}
        onCancel={() => setIsCommandModalVisible(false)}
        width={600}
        destroyOnClose
        confirmLoading={loading}
      >
        <Form
          form={commandForm}
          layout="vertical"
          initialValues={{
            command: '',
            description: '',
            scopeType: 'default',
            chatId: '',
            userId: ''
          }}
        >
          <Form.Item
            name="command"
            label={Translate.bot.commands.commandName}
            rules={[
              { required: true, message: Translate.bot.commands.commandNameRequired },
              { 
                pattern: /^[a-z0-9_]+$/, 
                message: Translate.bot.commands.commandNameFormat
              },
              {
                max: 32,
                message: Translate.bot.commands.commandNameLength
              }
            ]}
          >
            <Input 
              placeholder={Translate.bot.commands.commandNamePlaceholder}
              addonBefore="/"
              disabled={!!editingCommand} // 编辑时不允许修改命令名
            />
          </Form.Item>
          
          <Form.Item
            name="description"
            label={Translate.bot.commands.commandDescription}
            rules={[
              { required: true, message: Translate.bot.commands.commandDescRequired },
              { max: 256, message: Translate.bot.commands.commandDescLength }
            ]}
          >
            <Input placeholder={Translate.bot.commands.commandDescPlaceholder} />
          </Form.Item>

          <Form.Item
            name="scopeType"
            label={
              <Space>
                {Translate.bot.commands.scope.title}
                <Tooltip title={Translate.bot.commands.scope.description}>
                  <span style={{ color: '#999', cursor: 'help' }}>?</span>
                </Tooltip>
              </Space>
            }
          >
            <Select
              value={selectedScopeType}
              onChange={(value) => {
                setSelectedScopeType(value);
                commandForm.setFieldsValue({ scopeType: value });
                // 清空条件字段
                if (value !== 'chat' && value !== 'chat_member') {
                  commandForm.setFieldsValue({ chatId: '', userId: '' });
                }
              }}
              options={[
                {
                  value: 'default',
                  label: (
                    <Tooltip title={Translate.bot.commands.scope.scopeHelp.default}>
                      {Translate.bot.commands.scope.default}
                    </Tooltip>
                  )
                },
                {
                  value: 'all_private_chats',
                  label: (
                    <Tooltip title={Translate.bot.commands.scope.scopeHelp.all_private_chats}>
                      {Translate.bot.commands.scope.all_private_chats}
                    </Tooltip>
                  )
                },
                {
                  value: 'all_group_chats',
                  label: (
                    <Tooltip title={Translate.bot.commands.scope.scopeHelp.all_group_chats}>
                      {Translate.bot.commands.scope.all_group_chats}
                    </Tooltip>
                  )
                },
                {
                  value: 'chat',
                  label: (
                    <Tooltip title={Translate.bot.commands.scope.scopeHelp.chat}>
                      {Translate.bot.commands.scope.chat}
                    </Tooltip>
                  )
                },
                {
                  value: 'chat_member',
                  label: (
                    <Tooltip title={Translate.bot.commands.scope.scopeHelp.chat_member}>
                      {Translate.bot.commands.scope.chat_member}
                    </Tooltip>
                  )
                }
              ]}
            />
          </Form.Item>

          {(selectedScopeType === 'chat' || selectedScopeType === 'chat_member') && (
            <Form.Item
              name="chatId"
              label={Translate.bot.commands.scope.chatId}
              rules={[
                { required: true, message: Translate.bot.commands.scope.chatIdRequired }
              ]}
            >
              <Input placeholder={Translate.bot.commands.scope.chatIdPlaceholder} />
            </Form.Item>
          )}

          {selectedScopeType === 'chat_member' && (
            <Form.Item
              name="userId"
              label={Translate.bot.commands.scope.userId}
              rules={[
                { required: true, message: Translate.bot.commands.scope.userIdRequired }
              ]}
            >
              <Input placeholder={Translate.bot.commands.scope.userIdPlaceholder} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
});

BotCommands.displayName = 'BotCommands';

export default BotCommands;

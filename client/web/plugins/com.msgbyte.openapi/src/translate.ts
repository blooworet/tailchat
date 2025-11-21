import { localTrans } from '@capital/common';

export const Translate = {
  openapi: localTrans({ 'zh-CN': '开放平台', 'en-US': 'Open Api' }),
  noservice: localTrans({
    'zh-CN': '管理员没有开放 Openapi 服务',
    'en-US': 'The administrator did not open the Openapi service',
  }),
  enableBotCapability: localTrans({
    'zh-CN': '开启机器人能力',
    'en-US': 'Enable Bot Capability',
  }),
  name: localTrans({
    'zh-CN': '名称',
    'en-US': 'Name',
  }),
  operation: localTrans({
    'zh-CN': '操作',
    'en-US': 'Operation',
  }),
  delete: localTrans({
    'zh-CN': '删除',
    'en-US': 'Delete',
  }),
  enter: localTrans({
    'zh-CN': '进入',
    'en-US': 'Enter',
  }),
  createApplication: localTrans({
    'zh-CN': '创建应用',
    'en-US': 'Create Application',
  }),
  createApplicationSuccess: localTrans({
    'zh-CN': '创建应用成功',
    'en-US': 'Create Application Success',
  }),
  appNameCannotBeEmpty: localTrans({
    'zh-CN': '应用名不能为空',
    'en-US': 'App Name Cannot be Empty',
  }),
  appNameTooLong: localTrans({
    'zh-CN': '应用名过长',
    'en-US': 'App Name too Long',
  }),
  appDescCannotBeEmpty: localTrans({
    'zh-CN': '应用描述不能为空',
    'en-US': 'App Description Cannot be Empty',
  }),
  app: {
    basicInfo: localTrans({
      'zh-CN': '基础信息',
      'en-US': 'Basic Info',
    }),
    appName: localTrans({
      'zh-CN': '应用名称',
      'en-US': 'App Name',
    }),
    appDesc: localTrans({
      'zh-CN': '应用描述',
      'en-US': 'App Description',
    }),
    bot: localTrans({
      'zh-CN': '机器人',
      'en-US': 'Bot',
    }),
    botCommands: localTrans({
      'zh-CN': '机器人命令',
      'en-US': 'Bot Commands',
    }),
    webpage: localTrans({
      'zh-CN': '网页',
      'en-US': 'Web Page',
    }),
    oauth: localTrans({
      'zh-CN': '第三方登录',
      'en-US': 'OAuth',
    }),
    appcret: localTrans({
      'zh-CN': '应用凭证',
      'en-US': 'Application Credentials',
    }),
  },
  bot: {
    callback: localTrans({
      'zh-CN': '消息回调地址',
      'en-US': 'Callback Url',
    }),
    callbackTip: localTrans({
      'zh-CN':
        '机器人被 @ 的时候会向该地址发送请求(收件箱接受到新内容时会发送回调)',
      'en-US':
        'The bot will send a request to this address when it is mentioned (callback will be sent when the inbox receives new content)',
    }),
    allowGroup: localTrans({
      'zh-CN': '群组设置',
      'en-US': 'Group Settings',
    }),
    allowGroupTip: localTrans({
      'zh-CN': '控制机器人是否可以被添加到群组中。关闭后，机器人将仅限私聊使用',
      'en-US': 'Control whether the bot can be added to groups. When disabled, the bot will only work in private chats',
    }),
    allowGroupEnabled: localTrans({
      'zh-CN': '允许群组',
      'en-US': 'Allow Groups',
    }),
    allowGroupDisabled: localTrans({
      'zh-CN': '仅限私聊',
      'en-US': 'Private Only',
    }),
    receiveAllGroupMessages: localTrans({
      'zh-CN': '接收群内全部消息',
      'en-US': 'Receive all group messages',
    }),
    receiveAllGroupMessagesTip: localTrans({
      'zh-CN': '开启后，机器人在其加入的群组内将收到全部消息（无需 @）',
      'en-US': 'When enabled, the bot receives all messages in joined groups (no mention required).',
    }),
    commands: {
      title: localTrans({
        'zh-CN': '机器人命令管理',
        'en-US': 'Bot Commands Management',
      }),
      description: localTrans({
        'zh-CN': '配置机器人支持的斜杠命令，用户可以在聊天中使用这些命令与机器人交互',
        'en-US': 'Configure slash commands supported by the bot, users can use these commands to interact with the bot in chat',
      }),
      notEnabled: localTrans({
        'zh-CN': '机器人功能未启用',
        'en-US': 'Bot functionality not enabled',
      }),
      notEnabledDesc: localTrans({
        'zh-CN': '请先在机器人设置中启用机器人功能，然后再配置命令。',
        'en-US': 'Please enable bot functionality in bot settings first, then configure commands.',
      }),
      addCommand: localTrans({
        'zh-CN': '+ 添加命令',
        'en-US': '+ Add Command',
      }),
      commandCount: localTrans({
        'zh-CN': '已配置 {count} 个命令',
        'en-US': 'Configured {count} commands',
      }),
      noCommands: localTrans({
        'zh-CN': '暂无命令',
        'en-US': 'No commands',
      }),
      noCommandsDesc: localTrans({
        'zh-CN': '点击上方按钮添加机器人命令，让用户可以通过斜杠命令与机器人交互',
        'en-US': 'Click the button above to add bot commands, allowing users to interact with the bot through slash commands',
      }),
      edit: localTrans({
        'zh-CN': '编辑',
        'en-US': 'Edit',
      }),
      delete: localTrans({
        'zh-CN': '删除',
        'en-US': 'Delete',
      }),
      deleteConfirm: localTrans({
        'zh-CN': '确定要删除这个命令吗？',
        'en-US': 'Are you sure you want to delete this command?',
      }),
      addTitle: localTrans({
        'zh-CN': '添加命令',
        'en-US': 'Add Command',
      }),
      editTitle: localTrans({
        'zh-CN': '编辑命令',
        'en-US': 'Edit Command',
      }),
      commandName: localTrans({
        'zh-CN': '命令名',
        'en-US': 'Command Name',
      }),
      commandNamePlaceholder: localTrans({
        'zh-CN': '例如: start, help, weather',
        'en-US': 'e.g.: start, help, weather',
      }),
      commandNameRequired: localTrans({
        'zh-CN': '请输入命令名',
        'en-US': 'Please enter command name',
      }),
      commandNameFormat: localTrans({
        'zh-CN': '命令名只能包含小写字母、数字和下划线',
        'en-US': 'Command name can only contain lowercase letters, numbers and underscores',
      }),
      commandNameLength: localTrans({
        'zh-CN': '命令名最多32个字符',
        'en-US': 'Command name can be at most 32 characters',
      }),
      commandDescription: localTrans({
        'zh-CN': '命令描述',
        'en-US': 'Command Description',
      }),
      commandDescPlaceholder: localTrans({
        'zh-CN': '例如: 开始使用机器人',
        'en-US': 'e.g.: Start using the bot',
      }),
      commandDescRequired: localTrans({
        'zh-CN': '请输入命令描述',
        'en-US': 'Please enter command description',
      }),
      commandDescLength: localTrans({
        'zh-CN': '命令描述最多256个字符',
        'en-US': 'Command description can be at most 256 characters',
      }),
      updateSuccess: localTrans({
        'zh-CN': '更新成功',
        'en-US': 'Update successful',
      }),
      updateFailed: localTrans({
        'zh-CN': '更新失败',
        'en-US': 'Update failed',
      }),
      scope: {
        title: localTrans({
          'zh-CN': '命令范围',
          'en-US': 'Command Scope',
        }),
        description: localTrans({
          'zh-CN': '控制命令在不同场景下的可见性',
          'en-US': 'Control command visibility in different scenarios',
        }),
        default: localTrans({
          'zh-CN': '全局默认',
          'en-US': 'Default',
        }),
        all_private_chats: localTrans({
          'zh-CN': '所有私聊',
          'en-US': 'All Private Chats',
        }),
        all_group_chats: localTrans({
          'zh-CN': '所有群组',
          'en-US': 'All Group Chats',
        }),
        chat: localTrans({
          'zh-CN': '指定聊天',
          'en-US': 'Specific Chat',
        }),
        chat_member: localTrans({
          'zh-CN': '特定成员',
          'en-US': 'Specific Member',
        }),
        chatId: localTrans({
          'zh-CN': '聊天ID',
          'en-US': 'Chat ID',
        }),
        userId: localTrans({
          'zh-CN': '用户ID',
          'en-US': 'User ID',
        }),
        chatIdPlaceholder: localTrans({
          'zh-CN': '请输入聊天ID',
          'en-US': 'Please enter chat ID',
        }),
        userIdPlaceholder: localTrans({
          'zh-CN': '请输入用户ID',
          'en-US': 'Please enter user ID',
        }),
        chatIdRequired: localTrans({
          'zh-CN': '聊天ID是必需的',
          'en-US': 'Chat ID is required',
        }),
        userIdRequired: localTrans({
          'zh-CN': '用户ID是必需的',
          'en-US': 'User ID is required',
        }),
        scopeHelp: {
          default: localTrans({
            'zh-CN': '命令在所有场景下都可见（私聊和群组）',
            'en-US': 'Command is visible in all scenarios (private chats and groups)',
          }),
          all_private_chats: localTrans({
            'zh-CN': '命令仅在私聊中可见',
            'en-US': 'Command is only visible in private chats',
          }),
          all_group_chats: localTrans({
            'zh-CN': '命令仅在群组中可见',
            'en-US': 'Command is only visible in groups',
          }),
          chat: localTrans({
            'zh-CN': '命令仅在指定的聊天中可见',
            'en-US': 'Command is only visible in the specified chat',
          }),
          chat_member: localTrans({
            'zh-CN': '命令仅对指定聊天中的特定成员可见',
            'en-US': 'Command is only visible to specific members in the specified chat',
          }),
        },
      },
    },
  },
  oauth: {
    open: localTrans({
      'zh-CN': '开启 OAuth',
      'en-US': 'Open OAuth',
    }),
    allowedCallbackUrls: localTrans({
      'zh-CN': '允许的回调地址',
      'en-US': 'Allowed Callback Urls',
    }),
    allowedCallbackUrlsTip: localTrans({
      'zh-CN': '多个回调地址单独一行',
      'en-US': 'Multiple callback addresses on a single line',
    }),
  },
  // 机器人用户名相关翻译
  botUsername: localTrans({
    'zh-CN': '机器人用户名',
    'en-US': 'Bot Username',
  }),
  botUsernameCannotBeEmpty: localTrans({
    'zh-CN': '机器人用户名不能为空',
    'en-US': 'Bot username cannot be empty',
  }),
  usernameAlreadyTaken: localTrans({
    'zh-CN': '该用户名已被占用',
    'en-US': 'This username is already taken',
  }),
  checkUsernameError: localTrans({
    'zh-CN': '检查用户名可用性时出错',
    'en-US': 'Error checking username availability',
  }),
  checkingUsernameAvailability: localTrans({
    'zh-CN': '正在检查用户名可用性...',
    'en-US': 'Checking username availability...',
  }),
  usernameAvailable: localTrans({
    'zh-CN': '用户名可用',
    'en-US': 'Username available',
  }),
  usernameValidationFailed: localTrans({
    'zh-CN': '用户名验证失败',
    'en-US': 'Username validation failed',
  }),
  enterAppName: localTrans({
    'zh-CN': '请输入应用名称',
    'en-US': 'Please enter app name',
  }),
  enterAppDesc: localTrans({
    'zh-CN': '请输入应用描述',
    'en-US': 'Please enter app description',
  }),
  botUsernameExample: localTrans({
    'zh-CN': '例如：MyHelperBot（必须以bot结尾）',
    'en-US': 'e.g.: MyHelperBot (must end with bot)',
  }),
  // 用户名验证规则相关翻译
  usernameCannotBeEmpty: localTrans({
    'zh-CN': '用户名不能为空',
    'en-US': 'Username cannot be empty',
  }),
  usernameTooShort: localTrans({
    'zh-CN': '用户名长度不能少于 5 个字符',
    'en-US': 'Username must be at least 5 characters',
  }),
  usernameTooLong: localTrans({
    'zh-CN': '用户名长度不能超过 32 个字符',
    'en-US': 'Username cannot exceed 32 characters',
  }),
  usernameInvalidChars: localTrans({
    'zh-CN': '用户名只能包含英文字母、数字和下划线',
    'en-US': 'Username can only contain letters, numbers and underscores',
  }),
  usernameInvalidFormat: localTrans({
    'zh-CN': '用户名不能以下划线开头或结尾',
    'en-US': 'Username cannot start or end with underscore',
  }),
  botUsernameMustEndWithBot: localTrans({
    'zh-CN': '机器人用户名必须以 "bot" 或 "Bot" 结尾',
    'en-US': 'Bot username must end with "bot" or "Bot"',
  }),
  usernameReserved: localTrans({
    'zh-CN': '该用户名为系统保留，不可使用',
    'en-US': 'This username is reserved by the system',
  }),
  botUsernameTip: localTrans({
    'zh-CN': '设置机器人的用户名，用户可以通过 @用户名 来搜索和添加机器人。用户名必须以 \'bot\' 结尾，长度 5-32 字符，只能包含英文字母、数字和下划线。',
    'en-US': 'Set the bot username. Users can search and add the bot via @username. Username must end with \'bot\', be 5-32 characters long, and contain only letters, numbers and underscores.',
  }),
  botUsernameExampleShort: localTrans({
    'zh-CN': '例如：MyHelperBot',
    'en-US': 'e.g.: MyHelperBot',
  }),
  botUsernameNotSet: localTrans({
    'zh-CN': '尚未设置用户名',
    'en-US': 'Username not set',
  }),
  appSecret: localTrans({
    'zh-CN': 'App Secret',
    'en-US': 'App Secret',
  }),
};

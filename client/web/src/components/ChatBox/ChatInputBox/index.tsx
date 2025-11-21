import {
  getMessageTextDecorators,
} from '@/plugin/common';
import { isEnterHotkey } from '@/utils/hot-key';
import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
const ChatInputAddonLazy = React.lazy(() =>
  import('./Addon').then((m) => ({ default: m.ChatInputAddon }))
);
const SimpleAudioRecorderLazy = React.lazy(() =>
  import('./SimpleAudioRecorder').then((m) => ({ default: m.SimpleAudioRecorder }))
);
import { ChatInputBoxInput } from './input';
import { ClipboardHelper } from './clipboard-helper';
import { ChatInputActionContext, useChatInputMentionsContext } from './context';
import { uploadMessageImage } from './utils';
import {
  getCachedUserInfo,
  getCachedConverseInfo,
  isValidStr,
  useEvent,
  useSharedEventHandler,
  useUserInfo,
  useUserId,
  useGroupInfoContext,
} from '../../../../../shared';
import type { SendMessagePayloadMeta } from '../../../../../shared';
// Lazy plugin UIs (mobile-first)
const ChatInputEmotionLazy = React.lazy(() =>
  import('./Emotion').then((m) => ({ default: m.ChatInputEmotion }))
);
import ReplyKeyboardPanel from '../ReplyKeyboardPanel';
import type { ReplyKeyboardMeta } from '../../../../../shared/types/reply-keyboard';
import { useConverseMessageContext } from '../../../../../shared';
import { useReplyKeyboard } from '../../../hooks/useReplyKeyboard';
import _uniq from 'lodash/uniq';
import { ChatDropArea } from './ChatDropArea';
import { Icon } from 'tailchat-design';
import { usePasteHandler } from './usePasteHandler';
const ExpandedCommandListLazy = React.lazy(() =>
  import('./ExpandedCommandList').then((m) => ({ default: m.ExpandedCommandList }))
);
import { CommandMenuButton } from './CommandMenuButton';
import { useSlashCommands } from '@/hooks/useSlashCommands';
import { getSlashCommandRegistry } from '@/plugin/common/slash-commands/registry';
import { loadBotCommandsForConverse, getBotCommandManager } from '@/plugin/common/slash-commands/bot-commands';
import { useInputStateManager } from '@/hooks/useInputStateManager';
import { InputMode, StateTransitionEvent } from '@/types/inputState';

interface ChatInputBoxProps {
  onSendMsg: (msg: string, meta?: SendMessagePayloadMeta) => Promise<void>;
  converseId?: string;
  groupId?: string;
  isGroup?: boolean;
}
/**
 * 通用聊天输入框
 */
export const ChatInputBox = React.memo((props: ChatInputBoxProps) => {
  const inputRef = useRef(null as HTMLInputElement | null);
  const [message, setMessage] = useState('');
  const [mentions, setMentions] = useState([] as string[]);
  const { disabled } = useChatInputMentionsContext();
  const { runPasteHandlers, pasteHandlerContainer } = usePasteHandler();
  const inputContainerRef = useRef(null as HTMLDivElement | null);
  // Phase 2: placeholder meta state (Phase 3 will derive real meta from message stream)
  // Phase 3: derive active Reply Keyboard from message stream
  const { messages } = useConverseMessageContext();
  const uid = useUserId();
  const { activeMeta: rkMeta, placeholder: rkPlaceholder, dismiss: dismissRk, isOpen: isRkOpen, toggleOpen: toggleRkOpen, showToggle: showRkToggle, rawMeta: rkRawMeta } = useReplyKeyboard({
    converseId: props.converseId,
    userId: uid,
    messages: messages || [],
  });
  
  // 🎯 统一状态管理器 - 替代独立状态管理
  const inputStateManager = useInputStateManager({
    debug: process.env.NODE_ENV === 'development',
    transitionTimeout: 60000, // 🔧 设置60秒超时，匹配最大录制时长，避免录制过程中被重置
    callbacks: {
      onStateChange: (newState, oldState) => {
        // 状态变化回调
      },
      onConflict: (event, currentState) => {
        // 状态冲突处理
      }
    }
  });

  // 🎯 移动端适配优化
  const [isMobile, setIsMobile] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  // 基线高度与节流控制：仅在键盘显隐状态改变时触发渲染
  const viewportBaseRef = useRef((window as any).visualViewport?.height || window.innerHeight);
  const prevKeyboardVisibleRef = useRef(false);
  const resizeRafRef = useRef<number | null>(null);

  // 检测移动设备
  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
      const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
      const isSmallScreen = window.innerWidth <= 768;
      setIsMobile(isMobileDevice || isSmallScreen);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 移动端键盘检测与状态优化：使用 visualViewport + rAF 节流
  useEffect(() => {
    if (!isMobile || !isInputFocused) return;

    const vv: any = (window as any).visualViewport;

    const checkKeyboardState = () => {
      const currentHeight: number = vv?.height || window.innerHeight;
      const base = viewportBaseRef.current;
      const heightDiff = base - currentHeight;
      const keyboardShown = heightDiff > 150; // 键盘通常会占用超过150px

      if (prevKeyboardVisibleRef.current !== keyboardShown) {
        prevKeyboardVisibleRef.current = keyboardShown;
        setIsKeyboardVisible(keyboardShown);

        // 键盘弹出时的状态优化
        if (keyboardShown && inputStateManager.isMode(InputMode.RECORDING)) {
          inputStateManager.transition(StateTransitionEvent.STOP_RECORDING);
        }
      }

      // 当键盘收起时，更新基线以适配地址栏/方向变化
      if (!keyboardShown) {
        viewportBaseRef.current = currentHeight;
      }
    };

    const onResize = () => {
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
      }
      resizeRafRef.current = requestAnimationFrame(checkKeyboardState);
    };

    if (vv && typeof vv.addEventListener === 'function') {
      vv.addEventListener('resize', onResize);
      // 部分环境下键盘交互触发 scroll
      vv.addEventListener('scroll', onResize);
    } else {
      window.addEventListener('resize', onResize);
    }

    // 首次检查
    checkKeyboardState();

    return () => {
      if (resizeRafRef.current) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      if (vv && typeof vv.removeEventListener === 'function') {
        vv.removeEventListener('resize', onResize);
        vv.removeEventListener('scroll', onResize);
      } else {
        window.removeEventListener('resize', onResize);
      }
    };
  }, [isMobile, isInputFocused, inputStateManager]);

  // 移动端触摸优化
  const mobileOptimizedClass = useMemo(() => {
    if (!isMobile) return '';
    
    const classes = ['mobile-optimized'];
    if (isKeyboardVisible) classes.push('keyboard-showing');
    if (inputStateManager.state.hasActiveInput) classes.push('input-active');
    
    return classes.join(' ');
  }, [isMobile, isKeyboardVisible, inputStateManager.state.hasActiveInput]);
  
  // 主题特定样式由 Design Tokens 驱动，移除主题名分支

  // ✅ 获取当前用户ID（用于判断私聊对方）
  const userId = useUserId();
  
  // ✅ 获取当前聊天环境
  const currentUser = useUserInfo();
  const groupInfo = useGroupInfoContext(); // 获取群组信息（如果在群聊中）
  const [dmMemberIds, setDmMemberIds] = useState(undefined as string[] | undefined);
  const [isBotDM, setIsBotDM] = useState(false);
  const [isGroupHasBot, setIsGroupHasBot] = useState(false);
  const [isCommandsLoading, setIsCommandsLoading] = useState(false);
  
  // ✅ 命令按钮状态缓存（避免重复计算）
  const [commandButtonCache, setCommandButtonCache] = useState({
    converseId: null as string | null,
    hasCommands: false,
    timestamp: 0
  });
  
  
  // ✅ 获取私聊会话成员列表
  useEffect(() => {
    // 只处理私聊场景
    if (props.isGroup || !props.converseId) {
      setDmMemberIds(undefined);
      return;
    }
    
    // 异步获取私聊会话信息
    getCachedConverseInfo(props.converseId)
      .then((converseInfo: any) => {
        if (converseInfo && Array.isArray(converseInfo.members)) {
          setDmMemberIds(converseInfo.members);
        } else {
          setDmMemberIds([]);
        }
      })
      .catch((error: any) => {
        // 获取失败，设置为空数组
        setDmMemberIds([]);
      });
  }, [props.converseId, props.isGroup]);

  // ✅ 稳定化群组成员ID列表，深度比较members数组避免不必要的重新计算
  const groupMemberIds = useMemo(() => {
    if (props.isGroup && groupInfo?.members && Array.isArray(groupInfo.members)) {
      return groupInfo.members.map((m: any) => String(m.userId)).sort();
    }
    return null;
  }, [props.isGroup, JSON.stringify(groupInfo?.members?.map((m: any) => m.userId).sort() || [])]);

  // ✅ 获取会话成员列表（用于判断机器人是否在会话中）
  const converseMemberIds = useMemo(() => {
    // 如果是群聊，使用稳定化的群组成员列表
    if (props.isGroup) {
      return groupMemberIds;
    }
    
    // 私聊场景：使用异步获取的成员列表
    return dmMemberIds;
  }, [props.isGroup, groupMemberIds, dmMemberIds]);

  // 群聊：根据成员信息异步判断是否存在机器人（用于按钮显示）
  useEffect(() => {
    if (!props.isGroup || !groupInfo || !Array.isArray(groupInfo.members)) {
      setIsGroupHasBot(false);
      return;
    }
    const memberIds: string[] = groupInfo.members.map((m: any) => String(m.userId));
    if (memberIds.length === 0) {
      setIsGroupHasBot(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // 采样全部或前50个成员进行判定，命中一个即认为群内有机器人
        const sample = memberIds.slice(0, 50);
        const infos = await Promise.all(sample.map((id: string) => getCachedUserInfo(id).catch(() => null)));
        const botMembers = infos.filter((info: any) => info && (info.type === 'openapiBot' || info.type === 'pluginBot'));
        const hasBot = botMembers.length > 0;
        
        
        
        if (!cancelled) setIsGroupHasBot(hasBot);
      } catch (error) {
        if (!cancelled) setIsGroupHasBot(false);
      }
    })();
    return () => { cancelled = true; };
  }, [props.isGroup, groupInfo]);

  // 基于成员信息判断是否为与机器人的私聊（用于按钮显示与懒加载许可）
  useEffect(() => {
    if (props.isGroup || !dmMemberIds || dmMemberIds.length < 2 || !userId) {
      setIsBotDM(false);
      return;
    }
    const others = dmMemberIds.filter((id: string) => id !== userId);
    if (others.length !== 1) {
      setIsBotDM(false);
      return;
    }
    const otherId = others[0];
    
    getCachedUserInfo(otherId)
      .then((info: any) => {
        const isBot = info && (info.type === 'openapiBot' || info.type === 'pluginBot');
        
        setIsBotDM(!!isBot);
      })
      .catch((error: any) => {
        setIsBotDM(false);
      });
  }, [props.isGroup, dmMemberIds, userId]);
  
  // ✅ 稳定化用户ID，避免currentUser对象引用变化导致chatContext重建
  const stableUserId = useMemo(() => currentUser?._id, [currentUser?._id]);
  
  const chatContext = useMemo(() => {
    return !props.converseId || !stableUserId ? undefined : {
      isGroup: props.isGroup || false,
      groupId: props.groupId,
      userId: stableUserId,
      converseId: props.converseId,
      converseMemberIds: converseMemberIds
    };
  }, [props.converseId, props.groupId, props.isGroup, stableUserId, converseMemberIds]);


  // 仅将当前会话标记为激活，限制管理器只对该会话执行加载
  useEffect(() => {
    const manager = getBotCommandManager();
    manager.setActiveConverse(props.converseId ?? null);
    return () => {
      manager.setActiveConverse(null);
    };
  }, [props.converseId]);


  // 优化的懒加载机制：仅在用户交互时触发
  const ensureLoadIfNeeded = useCallback(async () => {
    if (!props.converseId) return;
    
    const manager = getBotCommandManager();
    
    // 快速检查缓存，避免重复加载
    // 无缓存系统：始终允许加载
    if (false) {
      return;
    }

    

    try {
      let members = converseMemberIds;
      if (!members) {
        const converseInfo = await getCachedConverseInfo(props.converseId);
        members = Array.isArray(converseInfo?.members) ? converseInfo.members : [];
      }
      
      if (members && members.length > 0) {
        // 筛选机器人用户ID
        const otherIds = members.filter((id: string) => id !== userId);
        let botUserIds: string[] = [];
        
        if (!props.isGroup && isBotDM && otherIds.length === 1) {
          // 私聊且已知对方是机器人
          botUserIds = [otherIds[0]];
        } else {
          // 批量检查用户类型
          const userInfoPromises = otherIds.map(async (id: string) => {
            try {
              const info = await getCachedUserInfo(id);
              if (info && (info.type === 'openapiBot' || info.type === 'pluginBot' || String(info.type) === '2')) {
                return id;
              }
            } catch {
              // 忽略单个用户信息获取失败
            }
            return null;
          });
          
          const results = await Promise.all(userInfoPromises);
          botUserIds = results.filter(Boolean) as string[];
        }

        if (botUserIds.length > 0) {
          
          await loadBotCommandsForConverse(props.converseId, props.groupId, botUserIds);
          
          // 更新命令按钮缓存
          setCommandButtonCache({
            converseId: props.converseId,
            hasCommands: true,
            timestamp: Date.now()
          });
          
        } else {
        }
      }
    } catch (error) {
    }
  }, [props.converseId, props.groupId, props.isGroup, converseMemberIds, userId, isBotDM]);

  // ✅ 用户显式操作的命令加载逻辑已移至 toggleCommandList，此useEffect现在是冗余的
  // useEffect(() => {
  //   // 此逻辑已移至 toggleCommandList，避免重复处理
  //   if (!props.converseId) return;
  //   if (isCommandListOpen) {
  //     ensureLoadIfNeeded();
  //   }
  // }, [isCommandListOpen, props.converseId, props.groupId, converseMemberIds]);

  // 去掉按 “/” 输入自动加载，防止普通用户触发加载

  // ✅ 会话切换时的状态同步和清理
  useEffect(() => {
    if (!props.converseId) return;
    
    const manager = getBotCommandManager();
    
    // 设置当前活跃会话（自动清理旧会话命令）
    manager.setActiveConverse(props.converseId);
    
    // 清理旧的命令按钮缓存
    if (commandButtonCache.converseId !== props.converseId) {
      setCommandButtonCache({
        converseId: props.converseId,
        hasCommands: false,
        timestamp: Date.now()
      });
    }
    
    return () => {
      // 组件卸载时清理
      if (manager) {
        manager.setActiveConverse(null);
      }
    };
  }, [props.converseId, commandButtonCache.converseId]);

  // ✅ 优化的命令按钮显示逻辑（基于缓存状态）
  const { getCommandSuggestions } = useSlashCommands(chatContext);
  
  const showCommandButton = useMemo(() => {
    if (!props.converseId) return false;
    
    // 🔧 修复逻辑：优先检查机器人资格，有机器人就显示按钮
    const eligible = isBotDM || isGroupHasBot;
    
    if (eligible) {
      return true; // 有机器人就显示按钮
    }
    
    // 备选：检查是否有已加载的命令（包括系统命令）
    try {
      const suggestions = getCommandSuggestions('/');
      const hasCommands = suggestions.length > 0;
      if (hasCommands) {
      }
      return hasCommands;
    } catch {
      return false;
    }
  }, [props.converseId, isBotDM, isGroupHasBot, getCommandSuggestions]);

  const sendMessage = useEvent(
    async (msg: string, meta?: SendMessagePayloadMeta) => {
      await props.onSendMsg(msg, meta);
      setMessage('');
      // 🎯 发送消息后重置到空闲状态
      inputStateManager.transition(StateTransitionEvent.RESET);
      inputRef.current?.focus();
    }
  );

  // 🎯 基于状态管理器的命令列表切换
  const toggleCommandList = useCallback(() => {
    const isCurrentlyOpen = inputStateManager.isMode(InputMode.COMMAND_LIST);
    
    if (isCurrentlyOpen) {
      // 关闭命令列表
      inputStateManager.transition(StateTransitionEvent.CLOSE_COMMAND_LIST);
    } else {
      // 打开命令列表
      if (inputStateManager.transition(StateTransitionEvent.OPEN_COMMAND_LIST)) {
        // 仅在成功打开时触发加载逻辑
        if (props.converseId) {
          const manager = getBotCommandManager();
          setIsCommandsLoading(true);
          ensureLoadIfNeeded().finally(() => {
            setIsCommandsLoading(false);
          });
        }
      }
    }
  }, [inputStateManager, props.converseId, ensureLoadIfNeeded]);

  // 🎯 基于状态管理器的命令选择处理
  const handleCommandSelect = useCallback((command: any) => {
    try {
      const commandText = command.usage || `/${command.name}`;
      setMessage(commandText);
      
      // 关闭命令列表并切换到输入状态
      inputStateManager.transition(StateTransitionEvent.CLOSE_COMMAND_LIST);
      inputStateManager.transition(StateTransitionEvent.START_TYPING);
      
      // 确保输入框获得焦点
      setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    } catch (error) {
    }
  }, [inputStateManager]);

  // 🎯 基于状态管理器的关闭命令列表处理
  const handleCloseCommandList = useCallback(() => {
    inputStateManager.transition(StateTransitionEvent.CLOSE_COMMAND_LIST);
  }, [inputStateManager]);

  // 统一输入事件处理：来自消息点击/建议面板等（v2: 附带来源/追踪/动作ID）
  useSharedEventHandler('applyChatInput', ({ text, mode = 'replace', source, traceId, actionId }: { text: string, mode?: string, source?: string, traceId?: string, actionId?: string }) => {
    if (mode === 'send') {
      sendMessage(text, {
        mentions: _uniq(mentions),
        inlineAction: {
          source,
          traceId,
          actionId,
        },
      } as any);
      return;
    }

    if (mode === 'append') {
      setMessage((prev: string) => `${prev}${text}`);
    } else {
      setMessage(text);
    }
    inputRef.current?.focus();
  });

  const handleSendMsg = useEvent(async () => {
    // ✅ 私聊机器人场景：自动添加机器人到 mentions
    let finalMentions = [...mentions];
    
    // 判断是否为私聊（无 groupId）
    if (!props.groupId && props.converseId) {
      try {
        // 获取会话信息
        const converseInfo = await getCachedConverseInfo(props.converseId);
        
        // 获取会话中除了当前用户外的其他成员
        const otherMembers = converseInfo.members?.filter(
          (memberId: string) => memberId !== userId
        );
        
        // 如果是单人私聊（会话成员恰好2人）
        if (otherMembers && otherMembers.length === 1) {
          const otherUserId = otherMembers[0];
          
          // 获取对方用户信息
          const otherUserInfo = await getCachedUserInfo(otherUserId);
          
          // 判断对方是否为机器人
          if (
            otherUserInfo &&
            (otherUserInfo.type === 'openapiBot' || otherUserInfo.type === 'pluginBot')
          ) {
            // 自动添加机器人到 mentions
            finalMentions = finalMentions;
          }
        }
      } catch (error) {
        // 异常情况不阻塞发送流程，继续使用原 mentions
      }
    }
    
    // ✅ 群聊场景：手动输入命令时自动添加机器人 mention
    if (props.groupId && message.trim().startsWith('/')) {
      const commandMatch = message.match(/^\/(\w+)/);
      if (commandMatch) {
        const commandName = commandMatch[1];
        const registry = getSlashCommandRegistry();
        
        // 查找该命令对应的机器人
        const command = registry.getCommand(commandName);
        
        if (command && command.type === 'bot' && command.botUserId) {
          // ✅ 找到对应的机器人命令，自动添加 mention（使用 botUserId，这是 MongoDB ObjectId）
          if (!finalMentions.includes(command.botUserId)) {
            finalMentions.push(command.botUserId);
          }
        }
        // 如果没有找到命令或不是机器人命令，正常发送消息
      }
    }
    
    // 发送消息
    sendMessage(message, {
      mentions: _uniq(finalMentions), // 发送前去重
    });
  });

  const handleSendKeyDown = useEvent(
    (e: any) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSendMsg();
      }
    }
  );

  // 发送音频消息
  const handleSendAudio = useEvent((audioUrl: string, duration: number, waveform?: number[]) => {
    
    // 🔧 使用Telegram策略压缩波形数据并Base64编码
    const waveformStr = waveform && Array.isArray(waveform) && waveform.length > 0 ? 
      (() => {
        // 内联压缩算法：将波形压缩到63个标准点（Telegram标准）
        const INPUT_WAVEFORM_LENGTH = 63;
        let compressedWaveform = waveform;
        
        if (waveform.length > INPUT_WAVEFORM_LENGTH) {
          // 简单的抽样压缩
          const step = waveform.length / INPUT_WAVEFORM_LENGTH;
          compressedWaveform = [];
          for (let i = 0; i < INPUT_WAVEFORM_LENGTH; i++) {
            const idx = Math.floor(i * step);
            compressedWaveform.push(waveform[idx] || 0);
          }
        }
        
        return btoa(JSON.stringify(compressedWaveform));
      })() : undefined;
    
    const cardData: any = {
      type: 'audio',
      url: audioUrl,
      duration: String(duration),
    };
    
    // 只有当waveform有效时才添加到cardData中
    if (waveformStr) {
      cardData.waveform = waveformStr;
    }
    
    const audioContent = getMessageTextDecorators().card(
      `[语音 ${Math.floor(duration)}"]`,
      cardData
    );
    
    props.onSendMsg(audioContent);
  });

  // 🎯 监听文本输入状态变化
  useEffect(() => {
    const hasText = message.trim().length > 0;
    const isCurrentlyTyping = inputStateManager.isMode(InputMode.TYPING);
    
    if (hasText && !isCurrentlyTyping && !inputStateManager.isMode(InputMode.RECORDING)) {
      // 有文本且当前不在输入状态，切换到输入状态
      inputStateManager.transition(StateTransitionEvent.START_TYPING);
    } else if (!hasText && isCurrentlyTyping) {
      // 没有文本且当前在输入状态，切换到空闲状态
      inputStateManager.transition(StateTransitionEvent.STOP_TYPING);
    }
  }, [message, inputStateManager]);

  // 🎤 录音状态管理现在由 SimpleAudioRecorder 组件内部处理
  const recordingStateRef = useRef(null as HTMLDivElement | null);

  const appendMsg = useEvent((append: string) => {
    setMessage(message + append);

    inputRef.current?.focus();
  });

  const handleKeyDown = useEvent(
    (e: any) => {
      if (isEnterHotkey(e.nativeEvent)) {
        e.preventDefault();
        handleSendMsg();
      }
    }
  );

  const handlePaste = useEvent(
    (e: any) => {
      const el: HTMLTextAreaElement | HTMLInputElement = e.currentTarget;
      const helper = new ClipboardHelper(e);

      if (!el.value) {
        // 当没有任何输入内容时才会执行handler
        const handlers = helper.matchPasteHandler();
        if (handlers.length > 0) {
          // 弹出选择框
          runPasteHandlers(handlers, e, {
            sendMessage,
            applyMessage: setMessage,
          });
          return;
        }
      }

      // If not match any paste handler or not paste without any input, fallback to image paste checker
      const image = helper.hasImage();
      if (image) {
        // 上传图片
        e.preventDefault();
        uploadMessageImage(image).then(({ url, width, height }) => {
          props.onSendMsg(
            getMessageTextDecorators().image(url, { width, height })
          );
        });
      }
    }
  );

  useSharedEventHandler('replyMessage', async (payload: any) => {
    if (inputRef.current) {
      inputRef.current.focus();
      if (payload && isValidStr(payload?.author)) {
        const userInfo = await getCachedUserInfo(payload.author);
        setMessage(
          `${getMessageTextDecorators().mention(
            payload.author,
            userInfo.nickname
          )} ${message}`
        );
      }
    }
  });

  return (
    <ChatInputActionContext.Provider
      value={{
        message,
        setMessage,
        sendMsg: props.onSendMsg,
        appendMsg,
      }}
    >
      <div className={`px-4 py-2 ${mobileOptimizedClass}`}>
        <div 
          ref={inputContainerRef}
          className={`bg-white dark:bg-gray-600 rounded-md relative input-content-area ${inputStateManager.state.hasActiveInput ? 'mode-transition' : ''}`}
        >
          {/* 展开的命令列表区域 - 基于状态管理器控制显示
              支持两种触发方式：
              1. 点击菜单按钮 (COMMAND_LIST 模式)
              2. 输入 / 字符 (message.startsWith('/'))
          */}
          {(inputStateManager.isMode(InputMode.COMMAND_LIST) || (message && message.startsWith('/'))) && (
            <div className={`command-list-container ${
              inputStateManager.isMode(InputMode.COMMAND_LIST) ? 'entering' : 'exiting'
            }`}>
              <React.Suspense fallback={<div className="p-2 opacity-60 text-xs">Loading…</div>}>
                <ExpandedCommandListLazy
                  query={message || '/'}
                  chatContext={chatContext}
                  onCommandSelect={handleCommandSelect}
                  onClose={handleCloseCommandList}
                  inputStateManager={inputStateManager}
                />
              </React.Suspense>
            </div>
          )}
          
          {/* Reply Keyboard (Phase 2 mounting; activation wired in Phase 3) */}
          {!disabled && rkMeta && (
            <div className="mb-2">
              <ReplyKeyboardPanel
                meta={rkMeta}
                disabled={disabled}
                placeholder={rkPlaceholder}
                onClickButton={async (text: string) => {
                  await props.onSendMsg(text);
                  setMessage('');
                  inputStateManager.transition(StateTransitionEvent.RESET);
                  if (rkMeta?.one_time === true) {
                    dismissRk();
                  }
                }}
              />
            </div>
          )}

          {/* 输入区域 */}
          <div className={`flex items-center`}>
            {/* 🎯 左侧：命令菜单按钮区域（基于状态管理器控制显示） */}
            {!disabled && inputStateManager.state.canShowCommandButton && (
              <div className={`pl-2`}>
                {isCommandsLoading && (isBotDM || isGroupHasBot) && (
                  <div
                    className={`w-8 h-8 flex items-center justify-center`}
                    aria-label="loading-commands"
                  >
                    <div
                      className="animate-spin rounded-full border-2 border-gray-300 border-t-transparent"
                      style={{ width: 16, height: 16 }}
                    />
                  </div>
                )}
                
                {!isCommandsLoading && showCommandButton && (
                  <CommandMenuButton
                    isOpen={inputStateManager.isMode(InputMode.COMMAND_LIST)}
                    onClick={toggleCommandList}
                    className={''}
                    inputStateManager={inputStateManager}
                  />
                )}
              </div>
            )}
            
            {/* This w-0 is magic to ensure show mention and long text */}
            <div className={`flex-1 w-0`}>
              {inputStateManager.isMode(InputMode.RECORDING) ? (
                // 🎯 录音状态 - 显示录音控制界面
                <div ref={recordingStateRef} className="recording-state-wrapper">
                  {/* 录音状态将通过 Portal 渲染到这里 */}
                </div>
              ) : (
                // 🎯 正常输入状态 - 受状态管理器控制
                <ChatInputBoxInput
                  inputRef={inputRef}
                  value={message}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                  onChange={(message: string, mentions: string[]) => {
                    setMessage(message || '');
                    setMentions(mentions || []);
                  }}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  disabled={!inputStateManager.state.canTypeText}
                  placeholderText={rkPlaceholder}
                  mobileOptimized={isMobile}
                />
              )}
            </div>
            
            {pasteHandlerContainer}

            {!disabled && (
              <div className={`px-2 flex space-x-1 input-button-group ${
                inputStateManager.isMode(InputMode.RECORDING) ? 'recording-mode' : 'recording-show'
              }`}>
                {/* E2EE 开关已移除：前端不再提供按钮控制 */}

                {/* 🎯 表情按钮 - 基于状态管理器控制显示 */}
                {inputStateManager.state.canShowEmojiButton && !isKeyboardVisible && (
                  <React.Suspense fallback={<span className="w-8 h-8 inline-flex items-center justify-center opacity-60"><Icon icon="mdi:emoticon-outline" className="text-xl" /></span>}>
                    <ChatInputEmotionLazy inputStateManager={inputStateManager} />
                  </React.Suspense>
                )}

                {/* 🎯 Reply Keyboard toggle with emoji/voice/attachment group */}
                {showRkToggle && (
                  <span
                    role="button"
                    aria-label={rkRawMeta?.toggleLabel || '键盘'}
                    title={rkRawMeta?.toggleLabel || '键盘'}
                    aria-pressed={isRkOpen}
                    className={`w-8 h-8 rounded-md inline-flex items-center justify-center transition-colors select-none ${
                      isRkOpen
                        ? 'bg-blue-50 text-blue-600 border border-transparent hover:bg-blue-100 dark:bg-gray-700 dark:text-blue-400'
                        : 'text-gray-500 hover:text-blue-500 dark:text-gray-300'
                    }`}
                    onClick={() => toggleRkOpen()}
                  >
                    <Icon
                      icon={rkRawMeta?.toggleIcon || (isRkOpen ? 'mdi:keyboard' : 'mdi:keyboard-outline')}
                      className={'text-xl'}
                    />
                  </span>
                )}

                {/* 🎯 发送/录音/附件按钮区域 - 基于状态管理器状态控制 */}
                {inputStateManager.state.canShowSendButton ? (
                  // 显示发送按钮（输入状态）
                  <Icon
                    icon="mdi:send-circle-outline"
                    className={`text-2xl ${isMobile ? 'active:scale-90' : 'cursor-pointer'}`}
                    role="button"
                    tabIndex={0}
                    aria-label="发送"
                    onKeyDown={handleSendKeyDown}
                    onClick={handleSendMsg}
                    style={{ 
                      touchAction: isMobile ? 'manipulation' : 'auto',
                      WebkitTapHighlightColor: 'transparent'
                    }}
                  />
                ) : inputStateManager.isMode(InputMode.RECORDING) ? (
                  // 录音模式：只显示录音按钮
                  <>
                    {inputStateManager.state.canShowAudioButton && (
                      <React.Suspense fallback={<span className="w-8 h-8 inline-flex items-center justify-center opacity-60"><Icon icon="mdi:microphone-outline" className="text-xl" /></span>}>
                        <SimpleAudioRecorderLazy 
                          onSendAudio={handleSendAudio} 
                          inputStateManager={inputStateManager}
                          recordingStateRef={recordingStateRef}
                          converseId={props.converseId}
                          groupId={props.groupId}
                        />
                      </React.Suspense>
                    )}
                  </>
                ) : (
                  // 默认状态显示录音按钮和更多选项
                  <>
                    {inputStateManager.state.canShowAudioButton && !isKeyboardVisible && (
                      <React.Suspense fallback={<span className="w-8 h-8 inline-flex items-center justify-center opacity-60"><Icon icon="mdi:microphone-outline" className="text-xl" /></span>}>
                        <SimpleAudioRecorderLazy 
                          onSendAudio={handleSendAudio} 
                          inputStateManager={inputStateManager}
                          recordingStateRef={recordingStateRef}
                          converseId={props.converseId}
                          groupId={props.groupId}
                        />
                      </React.Suspense>
                    )}
                    {inputStateManager.state.canShowAttachmentButton && !isKeyboardVisible && (
                      <React.Suspense fallback={<span className="w-8 h-8 inline-flex items-center justify-center opacity-60"><Icon icon="mdi:paperclip" className="text-xl" /></span>}>
                        <ChatInputAddonLazy inputStateManager={inputStateManager} />
                      </React.Suspense>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {!disabled && <ChatDropArea />}
    </ChatInputActionContext.Provider>
  );
});
ChatInputBox.displayName = 'ChatInputBox';

/**
 * 邀请相关的翻译工具
 * Invitation related translation utilities
 */

// @ts-ignore - 临时忽略类型错误
import { useLanguage } from 'tailchat-shared';

/**
 * 获取当前语言
 */
export const useCurrentLanguage = () => {
  // 使用 tailchat 的官方语言 Hook
  const languageObj = useLanguage();
  // 从语言对象中提取 language 属性
  return languageObj.language || 'zh-CN';
};

/**
 * 邀请翻译文本
 */
export const inviteTranslations = {
  'zh-CN': {
    selectInvitationMethod: '选择邀请方式',
    chooseInvitationMethodDesc: '选择您想要使用的邀请方式',
    createInvitationLink: '创建邀请链接',
    generateInvitationLinkDesc: '生成邀请链接分享给任何人',
    inviteFriends: '邀请好友',
    selectFromFriendsList: (count: number) => `从好友列表中选择 (${count} 位好友)`,
    cancel: '取消',
  },
  'en-US': {
    selectInvitationMethod: 'Select Invitation Method',
    chooseInvitationMethodDesc: 'Choose the invitation method you want to use',
    createInvitationLink: 'Create Invitation Link',
    generateInvitationLinkDesc: 'Generate invitation link to share with anyone',
    inviteFriends: 'Invite Friends',
    selectFromFriendsList: (count: number) => `Select from friends list (${count} friends)`,
    cancel: 'Cancel',
  },
};

/**
 * 获取邀请翻译文本的 Hook
 */
export const useInviteTranslations = () => {
  const language = useCurrentLanguage();
  
  // 语言映射：处理可能的语言代码变体
  const languageMap: { [key: string]: keyof typeof inviteTranslations } = {
    'zh': 'zh-CN',
    'zh-CN': 'zh-CN',
    'zh-Hans': 'zh-CN',
    'en': 'en-US',
    'en-US': 'en-US',
    'en-GB': 'en-US',
  };
  
  const mappedLanguage = languageMap[language] || 'zh-CN';
  const translations = inviteTranslations[mappedLanguage] || inviteTranslations['zh-CN'];
  
  return translations;
};

/**
 * 获取翻译文本的函数
 */
export const getInviteTranslation = (key: keyof typeof inviteTranslations['zh-CN'], language: string = 'zh-CN', args?: any[]) => {
  const translations = inviteTranslations[language as keyof typeof inviteTranslations] || inviteTranslations['zh-CN'];
  const translation = translations[key];
  
  if (typeof translation === 'function' && args) {
    return (translation as Function).apply(null, args);
  }
  
  return translation;
};

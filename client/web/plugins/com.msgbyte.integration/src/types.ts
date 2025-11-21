export type OpenAppCapability = 'bot' | 'webpage' | 'oauth';

export interface OpenAppBot {
  callbackUrl: string;
  username?: string;
  allowGroup?: boolean; // 是否允许被添加到群组，默认为true
}

export interface OpenAppInfo {
  _id: string;
  owner: string;
  appId: string;
  appName: string;
  appDesc: string;
  appIcon: string;
  capability: OpenAppCapability[];
  bot?: OpenAppBot;
}

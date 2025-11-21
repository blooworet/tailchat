import { postRequest } from './request';

// 临时类型定义，避免循环依赖
export interface BotCommand {
  command: string;
  description: string;
  usage?: string;
  examples?: string[];
}

/**
 * 机器人命令相关的API调用
 */

export interface BotCommandsResponse {
  appId: string;
  appName: string;
  commands: BotCommand[];
}

/**
 * 获取机器人命令列表
 */
export async function fetchBotCommands(appId: string): Promise<BotCommandsResponse> {
  const { data } = await postRequest('/openapi/app/getBotCommands', {
    appId,
  });
  
  return data;
}

/**
 * 保存机器人命令列表
 */
export async function saveBotCommands(
  appId: string, 
  commands: BotCommand[]
): Promise<void> {
  await postRequest('/openapi/app/setAppBotInfo', {
    appId,
    fieldName: 'commands',
    fieldValue: commands,
  });
}

/**
 * 获取所有启用机器人功能的应用及其命令
 */
export async function fetchAllBotCommands(): Promise<BotCommandsResponse[]> {
  // 这里可能需要一个专门的API来获取所有机器人命令
  // 暂时返回空数组，后续可以扩展
  return [];
}

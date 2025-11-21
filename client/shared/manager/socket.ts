import { buildRegList } from './buildReg';

interface PluginSocketEventListener {
  eventName: string;
  eventFn: (...args: any[]) => void;
}
export const [socketEventListeners, regSocketEventListener] =
  buildRegList<PluginSocketEventListener>();

/**
 * 原始 Socket 事件监听器（不添加 'notify:' 前缀）
 * 用于监听服务端直接广播的事件，如 'openapi.command.updated'
 */
interface RawSocketEventListener {
  eventName: string;
  eventFn: (...args: any[]) => void;
}
export const [rawSocketEventListeners, regRawSocketEventListener] =
  buildRegList<RawSocketEventListener>();

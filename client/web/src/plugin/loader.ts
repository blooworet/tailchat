import { regDependency, regSharedModule } from 'mini-star';
import { pluginManager } from './manager';
// 直接导入核心依赖，确保它们提前加载
import url from 'url';
import { getSlashCommandSystemManager } from './common/slash-commands';
import {
  pluginColorScheme,
  pluginRootRoute,
  pluginPanelRoute,
  pluginCustomPanel,
  pluginGroupPanel,
  pluginSettings,
} from './common/reg';

/**
 * 初始化插件
 */
export async function initPlugins(): Promise<void> {
  // 预先加载关键依赖
  await preloadCoreDependencies();
  registerDependencies();
  registerModules();

  // 初始化斜杠命令系统（使用新的统一管理器）
  const slashCommandSystemManager = getSlashCommandSystemManager();
  await slashCommandSystemManager.initialize({
    enableHealthCheck: true,
    autoRecovery: true
  });
  

  await pluginManager.initPlugins();

  // Dev-time enforcement warning: themes should be style-only
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
    try {
      const hasTheme = (pluginColorScheme as any[]).length > 0;
      const nonStyleRegs = [
        (pluginRootRoute as any[]).length,
        (pluginPanelRoute as any[]).length,
        (pluginCustomPanel as any[]).length,
        (pluginGroupPanel as any[]).length,
      ];
      const hasNonStyleRegs = nonStyleRegs.some((n) => n > 0);
      if (hasTheme && hasNonStyleRegs) {
        // eslint-disable-next-line no-console
        console.warn('[ThemeBoundary] Detected color schemes together with non-style plugin registrations (routes/panels). Ensure theme plugins provide style-only capabilities and avoid logic/JSX/route injections.');
      }

      // Settings are allowed only if they map to CSS variables. We cannot detect mapping here; just gentle reminder if both exist.
      if (hasTheme && (pluginSettings as any[]).length > 0) {
        // eslint-disable-next-line no-console
        console.warn('[ThemeBoundary] Theme plugin registered settings. Ensure settings only control CSS variables (design tokens), not logic.');
      }
    } catch {}
  }
}

/**
 * 预加载核心依赖，确保它们在插件加载前已经就绪
 */
async function preloadCoreDependencies() {
  // 为常用Node.js APIs提供polyfill
  if (typeof window !== 'undefined') {
    (window as any).url = url;
    // 提供最小化的 process.env 以避免插件中直接访问 process 导致 ReferenceError
    try {
      if (typeof (window as any).process === 'undefined') {
        (window as any).process = { env: {} } as any;
      } else if (typeof (window as any).process.env === 'undefined') {
        (window as any).process.env = {} as any;
      }
    } catch {}
  }
}

/**
 * 为浏览器环境提供简单的 Buffer polyfill
 */
function createBufferPolyfill() {
  const TextEncoder = globalThis.TextEncoder;
  const TextDecoder = globalThis.TextDecoder;

  const encodeString = (str: string, encoding = 'utf8'): Uint8Array => {
    if (encoding === 'utf8' || encoding === 'utf-8') {
      return new TextEncoder().encode(str);
    }
    // 对于其他编码，使用简单的 latin1 fallback
    const arr = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      arr[i] = str.charCodeAt(i) & 0xFF;
    }
    return arr;
  };

  const decodeBuffer = (buf: Uint8Array, encoding = 'utf8'): string => {
    if (encoding === 'utf8' || encoding === 'utf-8') {
      return new TextDecoder().decode(buf);
    }
    // 对于其他编码，使用简单的 latin1 fallback
    let str = '';
    for (let i = 0; i < buf.length; i++) {
      str += String.fromCharCode(buf[i]);
    }
    return str;
  };

  return {
    from: (data: any, encodingOrOffset?: any, length?: any) => {
      if (typeof data === 'string') {
        const encoding = typeof encodingOrOffset === 'string' ? encodingOrOffset : 'utf8';
        return encodeString(data, encoding);
      }
      if (data instanceof Uint8Array) {
        return new Uint8Array(data);
      }
      if (Array.isArray(data)) {
        return new Uint8Array(data);
      }
      if (data && typeof data === 'object' && 'buffer' in data) {
        return new Uint8Array(data.buffer);
      }
      return new Uint8Array(0);
    },
    alloc: (size: number) => new Uint8Array(size),
    allocUnsafe: (size: number) => new Uint8Array(size),
    allocUnsafeSlow: (size: number) => new Uint8Array(size),
    isBuffer: (obj: any) => obj instanceof Uint8Array,
    concat: (list: Uint8Array[], totalLength?: number) => {
      const length = totalLength ?? list.reduce((a, b) => a + b.length, 0);
      const result = new Uint8Array(length);
      let offset = 0;
      for (const buf of list) {
        result.set(buf, offset);
        offset += buf.length;
      }
      return result;
    },
    toString: function(encoding?: string) {
      return decodeBuffer(this as any, encoding);
    },
  };
}

function registerDependencies() {
  // 使用已经加载的实例注册依赖，而不是异步加载
  regDependency('url', () => Promise.resolve(url));
  
  // 其他依赖保持异步加载
  regDependency('react', () => import('react'));
  regDependency('react/jsx-runtime', () => import('react/jsx-runtime'));
  regDependency('react-router', () => import('react-router'));
  regDependency('axios', () => import('axios')); // 用于插件的第三方包使用axios作为依赖的情况下，可以减少包体积
  regDependency('styled-components', () => import('styled-components')); // 仅用于第三方插件. tailchat本身更多使用 tailwindcss
  regDependency('zustand', () => import('zustand')); // 仅用于第三方插件. tailchat本身更多使用 tailwindcss
  regDependency(
    'zustand/middleware/immer',
    () => import('zustand/middleware/immer')
  ); // 仅用于第三方插件. tailchat本身更多使用 tailwindcss

  // 一些插件打包产物可能意外包含 Node 内置模块名，提供空实现以避免浏览器侧解析失败
  const empty = async () => ({ /* noop stub for browser */ });
  regDependency('module', empty as any);
  regDependency('fs', empty as any);
  regDependency('http', empty as any);
  regDependency('https', empty as any);
  regDependency('child_process', empty as any);
  
  // 为 buffer 模块提供 polyfill，使用同步返回确保立即可用
  const bufferPolyfill = { Buffer: createBufferPolyfill() } as any;
  regDependency('buffer', () => Promise.resolve(bufferPolyfill));
}

function registerModules() {
  regSharedModule('@capital/common', () => import('./common/index'));
  regSharedModule('@capital/component', () => import('./component/index'));
}


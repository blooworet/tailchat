/**
 * Tailchat 类型定义统一导出
 */

export type PromiseType<P extends Promise<any>> = P extends Promise<infer T>
  ? T
  : never;

export type FunctionReturningPromise = (...args: any[]) => Promise<any>;

export * from './reply-keyboard';

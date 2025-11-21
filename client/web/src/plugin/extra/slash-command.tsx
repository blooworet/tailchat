import { regInlineActionDecorator } from '../common/inline-actions';

// 简单识别：行内以 / 开头、由字母数字下划线组成的命令片段（不跨空格）
const SLASH_TOKEN_REGEXP = /(^|\s)(\/[A-Za-z][A-Za-z0-9_]*)(?=\s|$|[.,!?:;])/g;
const IMMEDIATE_SEND = new Set<string>(['/start', '/help', '/tokens']);

// 斜杠命令内联装饰器（蓝色高亮命令）
regInlineActionDecorator(({ text }) => {
  if (!text || text.indexOf('/') === -1) return null;
  const actions: { id: string; type: 'command'; label: string; params?: any }[] = [];
  const ranges: { offset: number; length: number; actionId: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = SLASH_TOKEN_REGEXP.exec(text)) !== null) {
    const cmd = match[2];
    if (!cmd) continue;
    const id = `slash:${cmd}:${match.index}`;
    const mode = IMMEDIATE_SEND.has(cmd) ? 'send' : 'replace';
    actions.push({ id, type: 'command', label: cmd, params: { text: cmd, mode } });
    const start = match.index + match[1].length;
    ranges.push({ offset: start, length: cmd.length, actionId: id });
    if (match.index === SLASH_TOKEN_REGEXP.lastIndex) {
      SLASH_TOKEN_REGEXP.lastIndex++;
    }
  }
  if (actions.length === 0 || ranges.length === 0) return null;
  return { actions, ranges } as any;
});



export type ReplyKeyboardButton = { text: string };
export type ReplyKeyboardSelective = { visibleForUserIds?: string[] };
export type ReplyKeyboardMeta = {
  keyboard?: ReplyKeyboardButton[][];
  resize?: boolean;
  one_time?: boolean;
  remove?: boolean;
  placeholder?: string;
  selective?: ReplyKeyboardSelective;
  // New optional fields for Telegram-like toggle UX
  trigger?: 'auto' | 'button';
  toggleLabel?: string;
  toggleIcon?: string;
};

function clampInt(n: any, min: number, max: number): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : min;
  return Math.max(min, Math.min(max, x));
}

function isString(v: any): v is string {
  return typeof v === 'string';
}

export function validateReplyKeyboardMeta(input: any, logger?: any): ReplyKeyboardMeta | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  if (input.remove === true) {
    const out: ReplyKeyboardMeta = { remove: true };
    if (isString(input.placeholder)) {
      out.placeholder = String(input.placeholder).slice(0, 64);
    }
    return out;
  }
  const out: ReplyKeyboardMeta = {};
  const kb: any = input.keyboard;
  if (!Array.isArray(kb)) {
    return null;
  }
  const rowsMax = 8;
  const colsMax = 8;
  const rowCount = Math.min(kb.length, rowsMax);
  const rows: ReplyKeyboardButton[][] = [];
  for (let i = 0; i < rowCount; i++) {
    const row = kb[i];
    if (!Array.isArray(row)) continue;
    const colCount = Math.min(row.length, colsMax);
    const cols: ReplyKeyboardButton[] = [];
    for (let j = 0; j < colCount; j++) {
      const btn = row[j];
      const text = isString(btn?.text) ? String(btn.text).trim() : '';
      if (!text) continue;
      const t = text.length > 32 ? text.slice(0, 32) : text;
      cols.push({ text: t });
    }
    if (cols.length > 0) rows.push(cols);
  }
  if (rows.length === 0) {
    return null;
  }
  out.keyboard = rows;
  if (typeof input.resize === 'boolean') out.resize = !!input.resize;
  if (typeof input.one_time === 'boolean') out.one_time = !!input.one_time;
  if (isString(input.placeholder)) out.placeholder = String(input.placeholder).slice(0, 64);
  if (input.selective && typeof input.selective === 'object') {
    const vis = input.selective.visibleForUserIds;
    if (Array.isArray(vis)) {
      const list = vis.filter((x: any) => isString(x) && x.length > 0).slice(0, 100);
      if (list.length > 0) out.selective = { visibleForUserIds: list };
    }
  }
  // New fields validation/pass-through with sane limits
  if (isString(input.trigger)) {
    const v = input.trigger.toLowerCase();
    if (v === 'auto' || v === 'button') {
      out.trigger = v as 'auto' | 'button';
    }
  }
  if (isString(input.toggleLabel)) {
    // keep short label
    out.toggleLabel = String(input.toggleLabel).slice(0, 32);
  }
  if (isString(input.toggleIcon)) {
    // icon name like 'mdi:keyboard-outline'
    out.toggleIcon = String(input.toggleIcon).slice(0, 64);
  }
  try {
    const bytes = Buffer.byteLength(JSON.stringify(out), 'utf8');
    if (bytes > 8192) {
      if (logger?.warn) logger.warn('[replyKeyboard] meta too large, dropped');
      return null;
    }
  } catch {}
  return out;
}

export type ReplyKeyboardButton = {
  text: string;
};

export type ReplyKeyboardSelective = {
  visibleForUserIds?: string[];
};

export type ReplyKeyboardMeta = {
  keyboard: ReplyKeyboardButton[][];
  resize?: boolean;
  one_time?: boolean;
  remove?: boolean;
  placeholder?: string;
  selective?: ReplyKeyboardSelective;
  trigger?: 'auto' | 'button';
  toggleLabel?: string;
  toggleIcon?: string;
};

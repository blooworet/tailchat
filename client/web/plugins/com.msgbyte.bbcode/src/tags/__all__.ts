import { registerBBCodeTag } from '../bbcode/parser';
import { CodeTag } from './CodeTag';
import { ImgTag } from './ImgTag';
import { MentionTag } from './MentionTag';
import { PlainText } from './PlainText';
import { UrlTag } from './UrlTag';
import { EmojiTag } from './EmojiTag';
import { MarkdownTag } from './MarkdownTag';
import { BoldTag } from './BoldTag';
import { ItalicTag } from './ItalicTag';
import { UnderlinedTag } from './UnderlinedTag';
import { DeleteTag } from './DeleteTag';
import { CardTag } from './CardTag';

// 注意：mini-star 单文件插件不推荐直接引入样式文件，避免运行时解析失败

/**
 * Reference: https://en.wikipedia.org/wiki/BBCode
 */
registerBBCodeTag('_text', PlainText);
registerBBCodeTag('b', BoldTag);
registerBBCodeTag('i', ItalicTag);
registerBBCodeTag('u', UnderlinedTag);
registerBBCodeTag('s', DeleteTag);
registerBBCodeTag('url', UrlTag);
registerBBCodeTag('img', ImgTag);
registerBBCodeTag('code', CodeTag);
registerBBCodeTag('at', MentionTag);
registerBBCodeTag('emoji', EmojiTag);
registerBBCodeTag('markdown', MarkdownTag);
registerBBCodeTag('md', MarkdownTag); // alias
registerBBCodeTag('card', CardTag);

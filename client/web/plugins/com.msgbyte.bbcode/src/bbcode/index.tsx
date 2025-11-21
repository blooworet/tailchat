import React, { Fragment } from 'react';
import bbcodeParser from './parser';

// 简单的 URL 正则表达式，用于检测常见的 HTTP/HTTPS URL
// 避免使用 url-regex 库以避免浏览器兼容性问题（global 对象依赖）
const URL_REGEX = /https?:\/\/[^\s\[\]<>]+/g;

/**
 * 客户端预处理文本
 * @param plainText 服务端文本
 */
export function preProcessLinkText(plainText: string): string {
  const text = plainText.replace(
    URL_REGEX,
    '[url]$&[/url]'
  ); // 将聊天记录中的url提取成bbcode 需要过滤掉被bbcode包住的部分

  return text;
}

// 处理所有的预处理文本
export function preProcessText(plainText: string): string {
  return bbcodeParser.preProcessText(plainText, preProcessLinkText);
}

interface BBCodeProps {
  plainText: string;
}
export const BBCode: React.FC<BBCodeProps> = React.memo(({ plainText }) => {
  const bbcodeComponent = bbcodeParser.render(preProcessText(plainText ?? ''));

  return <Fragment>{bbcodeComponent}</Fragment>;
});
BBCode.displayName = 'BBCode';

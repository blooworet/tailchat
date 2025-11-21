import { UserListItem } from '@/components/UserListItem';
import { getMessageTextDecorators, useGroupIdContext } from '@/plugin/common';
import { stopPropagation } from '@/utils/dom-helper';
import React from 'react';
import { Mention, MentionsInput } from 'react-mentions';
import { getGroupConfigWithInfo, t, useGroupInfo } from 'tailchat-shared';
import { useChatInputMentionsContext } from './context';
import { MentionCommandItem } from './MentionCommandItem';
import { SlashCommandItem } from './SlashCommandItem';
// import { useSlashCommands } from '@/hooks/useSlashCommands'; // 不再需要，斜杠命令使用内嵌展开方案
import './input.less';

const defaultChatInputBoxInputStyle = {
  input: {
    overflow: 'auto',
    maxHeight: 70,
  },
  highlighter: {
    boxSizing: 'border-box',
    overflow: 'hidden',
    maxHeight: 70,
  },
};

interface ChatInputBoxInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>,
    'value' | 'onChange'
  > {
  inputRef?: React.Ref<HTMLInputElement>;
  value: string;
  onChange: (message: string, mentions: string[]) => void;
  placeholderText?: string;
  mobileOptimized?: boolean;
  onFocus?: React.FocusEventHandler<any>;
  onBlur?: React.FocusEventHandler<any>;
}
export const ChatInputBoxInput: React.FC<ChatInputBoxInputProps> = React.memo(
  (props) => {
    const { users, panels, placeholder, disabled } =
      useChatInputMentionsContext();
    const groupId = useGroupIdContext();
    const groupInfo = useGroupInfo(groupId);
    const { hideGroupMemberDiscriminator } = getGroupConfigWithInfo(groupInfo);
    // 注意：斜杠命令现在使用内嵌展开方案，不再使用 react-mentions 的建议框
    // const { getCommandSuggestions } = useSlashCommands();

    const isMobile = props.mobileOptimized === true;

    const mobileChatInputStyle = {
      input: {
        overflow: 'auto' as const,
        maxHeight: 56,
      },
      highlighter: {
        boxSizing: 'border-box' as const,
        overflow: 'hidden' as const,
        maxHeight: 56,
      },
    };

    return (
      <MentionsInput
        inputRef={props.inputRef}
        className="chatbox-mention-input"
        placeholder={props.placeholderText ?? placeholder ?? t('输入一些什么')}
        disabled={disabled}
        style={isMobile ? (mobileChatInputStyle as any) : (defaultChatInputBoxInputStyle as any)}
        maxLength={1000}
        value={props.value}
        onChange={(e, newValue, _, mentions) =>
          props.onChange(
            newValue,
            mentions.filter((m) => m.display.startsWith('@')).map((m) => m.id) // 仅处理mention的数据进行记录
          )
        }
        onKeyDown={props.onKeyDown}
        onPaste={props.onPaste}
        onContextMenu={stopPropagation}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
        allowSuggestionsAboveCursor={isMobile ? false : true}
        forceSuggestionsAboveCursor={isMobile ? false : true}
      >
        <Mention
          trigger="@"
          data={
            (query) =>
              (users ?? [])
                .filter((u) => u.display?.includes(query))
                .slice(0, 20) // max display 20 item at most
          }
          displayTransform={(id, display) => `@${display}`}
          appendSpaceOnAdd={true}
          renderSuggestion={(suggestion) => (
            <UserListItem
              userId={String(suggestion.id)}
              hideDiscriminator={hideGroupMemberDiscriminator}
            />
          )}
          markup={getMessageTextDecorators().mention('__id__', '__display__')}
        />
        <Mention
          trigger="#"
          data={panels ?? []}
          displayTransform={(id, display) => `#${display}`}
          appendSpaceOnAdd={true}
          renderSuggestion={(suggestion) => (
            <MentionCommandItem
              icon="mdi:pound"
              label={suggestion.display ?? String(suggestion.id)}
            />
          )}
          markup={getMessageTextDecorators().url('__id__', '#__display__')}
        />
        {/* 斜杠命令现在使用内嵌展开方案，不再使用 react-mentions 的建议框 */}
        {/* <Mention
          trigger="/"
          data={filterCommands}
          displayTransform={(id, display) => display}
          appendSpaceOnAdd={true}
          renderSuggestion={(suggestion) => (
            <SlashCommandItem command={suggestion.command} />
          )}
          markup="/__display__"
        /> */}
      </MentionsInput>
    );
  }
);
ChatInputBoxInput.displayName = 'ChatInputBoxInput';

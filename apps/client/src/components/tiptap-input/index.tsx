import { useFilteredUsers } from '@/features/server/users/hooks';
import { TestId, type TCommandInfo } from '@mikotord/shared';
import Emoji, { gitHubEmojis } from '@tiptap/extension-emoji';
import Link from '@tiptap/extension-link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type Ref
} from 'react';
import {
  COMMANDS_STORAGE_KEY,
  CommandSuggestion
} from './extensions/commands/command-suggestion';
import { PluginCommandNode } from './extensions/commands/plugin-command-node';
import { SlashCommands } from './extensions/commands/slash-commands-extension';
import { EmojiSuggestion } from './extensions/emojis/suggestions';
import { Mention } from './extensions/mentions';
import { MentionNode } from './extensions/mentions/node';
import {
  MENTION_STORAGE_KEY,
  MentionSuggestion
} from './extensions/mentions/suggestion';
import type { TEmojiItem } from './helpers';

type TTiptapInputHandle = {
  insertEmoji: (emoji: TEmojiItem) => void;
  insertText: (text: string) => void;
  focus: () => void;
};

type TTiptapInputProps = {
  disabled?: boolean;
  readOnly?: boolean;
  value?: string;
  placeholder?: string;
  onChange?: (html: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  onArrowUp?: () => void;
  onTyping?: () => void;
  commands?: TCommandInfo[];
  ref?: Ref<TTiptapInputHandle>;
};

const TiptapInput = memo(
  ({
    value,
    placeholder,
    onChange,
    onSubmit,
    onCancel,
    onArrowUp,
    onTyping,
    disabled,
    readOnly,
    commands,
    ref
  }: TTiptapInputProps) => {
    const readOnlyRef = useRef(readOnly);
    const onSubmitRef = useRef(onSubmit);
    const onCancelRef = useRef(onCancel);
    const onArrowUpRef = useRef(onArrowUp);

    readOnlyRef.current = readOnly;
    onSubmitRef.current = onSubmit;
    onCancelRef.current = onCancel;
    onArrowUpRef.current = onArrowUp;

    const users = useFilteredUsers();

    const extensions = useMemo(() => {
      const exts = [
        StarterKit.configure({
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          hardBreak: {
            HTMLAttributes: {
              class: 'hard-break'
            }
          },
          heading: false,
          horizontalRule: false,
          italic: false,
          listItem: false,
          orderedList: false,
          strike: false
        }),
        Link.configure({
          autolink: true,
          defaultProtocol: 'https',
          openOnClick: false,
          HTMLAttributes: {
            target: '_blank',
            rel: 'noopener noreferrer'
          },
          shouldAutoLink: (url) => {
            return /^https?:\/\//i.test(url);
          }
        }),
        Emoji.configure({
          emojis: gitHubEmojis,
          enableEmoticons: true,
          suggestion: EmojiSuggestion,
          HTMLAttributes: {
            class: 'emoji-image'
          }
        }),
        Mention.configure({
          users,
          suggestion: MentionSuggestion
        }),
        MentionNode,
        PluginCommandNode
      ];

      if (commands) {
        exts.push(
          SlashCommands.configure({
            commands,
            suggestion: CommandSuggestion
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any
        );
      }

      return exts;
    }, [commands, users]);

    const editor = useEditor({
      extensions,
      content: value,
      editable: !disabled,
      onUpdate: ({ editor }) => {
        const html = editor.getHTML();

        onChange?.(html);

        if (!editor.isEmpty) {
          onTyping?.();
        }
      },
      editorProps: {
        attributes: {
          'data-testid': TestId.MESSAGE_COMPOSE_EDITOR
        },
        handleKeyDown: (_view, event) => {
          // block all input when readOnly
          if (readOnlyRef.current) {
            event.preventDefault();
            return true;
          }

          const suggestionElement = document.querySelector(
            '.bg-popover, [data-suggestion-popover]'
          );
          const hasSuggestions =
            suggestionElement && document.body.contains(suggestionElement);

          if (event.key === 'Enter') {
            if (event.shiftKey) {
              return false;
            }

            // if suggestions are active, don't handle Enter - let the suggestion handle it
            if (hasSuggestions) {
              return false;
            }

            event.preventDefault();
            onSubmitRef.current?.();
            return true;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            onCancelRef.current?.();
            return true;
          }

          if (event.key === 'ArrowUp') {
            if (editor.isEmpty && onArrowUpRef.current) {
              event.preventDefault();
              onArrowUpRef.current();
              return true;
            }
            return false;
          }

          return false;
        },
        handleClickOn: (_view, _pos, _node, _nodePos, event) => {
          const target = event.target as HTMLElement;

          // prevents clicking on links inside the edit from opening them in the browser
          if (target.tagName === 'A') {
            event.preventDefault();

            return true;
          }

          return false;
        },
        handlePaste: () => !!readOnlyRef.current,
        handleDrop: () => readOnlyRef.current
      }
    });

    const handleEmojiSelect = (emoji: TEmojiItem) => {
      if (disabled || readOnly) return;

      if (emoji.shortcodes.length > 0) {
        editor?.chain().focus().setEmoji(emoji.shortcodes[0]).run();
      }
    };

    useImperativeHandle(ref, () => ({
      insertEmoji: handleEmojiSelect,
      insertText: (text: string) => {
        if (disabled || readOnly) return;

        editor?.chain().focus().insertContent(text).run();
      },
      focus: () => editor?.commands.focus()
    }));

    useEffect(() => {
      if (editor) {
        if (editor.storage.emoji) {
          editor.storage.emoji.emojis = gitHubEmojis;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const applyEmojiOptions = (extension: any) => {
          const typed = extension;

          if (typed.name === 'emoji' && typed.options) {
            typed.options.emojis = gitHubEmojis;
          }
        };

        editor.extensionManager.extensions.forEach(applyEmojiOptions);
        editor.options.extensions?.forEach(applyEmojiOptions);
      }
    }, [editor]);

    // keep commands storage in sync with plugin commands from the store
    useEffect(() => {
      if (editor && commands) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const storage = editor.storage as any;
        if (storage[COMMANDS_STORAGE_KEY]) {
          storage[COMMANDS_STORAGE_KEY].commands = commands;
        }
      }
    }, [editor, commands]);

    // keep mention users storage in sync with the users from the store
    useEffect(() => {
      if (editor) {
        const storage = editor.storage as unknown as Record<
          string,
          { users?: typeof users }
        >;

        if (storage[MENTION_STORAGE_KEY]) {
          storage[MENTION_STORAGE_KEY].users = users;
        }
      }
    }, [editor, users]);

    useEffect(() => {
      if (editor && value !== undefined) {
        const currentContent = editor.getHTML();

        // only update if content is actually different to avoid cursor jumping
        if (currentContent !== value) {
          editor.commands.setContent(value);
        }
      }
    }, [editor, value]);

    useEffect(() => {
      if (editor) {
        editor.setEditable(!disabled);
      }
    }, [editor, disabled]);

    const isEmpty = !editor || editor.isEmpty;

    return (
      <div className="relative flex min-w-0 flex-1">
        <EditorContent
          editor={editor}
          className={`w-full tiptap relative transition-colors [&_.ProseMirror]:px-5 [&_.ProseMirror]:py-[14px] [&_.ProseMirror:focus]:outline-none ${
            disabled ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        />
        {isEmpty && placeholder && (
          <div className="absolute inset-0 px-5 py-[14px] text-muted-foreground/50 pointer-events-none select-none truncate">
            {placeholder}
          </div>
        )}
      </div>
    );
  }
);

export { TiptapInput, type TTiptapInputHandle };

import { EmojiPicker } from '@/components/emoji-picker';
import { PluginSlotRenderer } from '@/components/plugin-slot-renderer';
import type { TTiptapInputHandle } from '@/components/tiptap-input';
import { TiptapInput } from '@/components/tiptap-input';
import { LocalStorageKey } from '@/helpers/storage';

import { useChannelById } from '@/features/server/channels/hooks';
import {
  useCan,
  useChannelCan,
  usePublicServerSettings
} from '@/features/server/hooks';
import { useFlatPluginCommands } from '@/features/server/plugins/hooks';
import { getFileNameWithLockedExtension } from '@/helpers/file-name';
import { getFileUrl } from '@/helpers/get-file-url';
import { useUploadFiles, type TDisplayItem } from '@/hooks/use-upload-files';
import { getTRPCClient } from '@/lib/trpc';
import type { TReplyTarget } from '@/types';
import type {
  TFile,
  TJoinedMessage,
  TJoinedPublicUser,
  TTempFile
} from '@mikotord/shared';
import {
  ChannelPermission,
  isEmptyMessage,
  Permission,
  PluginSlot
} from '@mikotord/shared';
import { Button, Spinner } from '@mikotord/ui';
import { filesize } from 'filesize';
import {
  Check,
  Pencil,
  Plus,
  Reply,
  SendHorizontal,
  Smile,
  X
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject
} from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_MAX_HEIGHT_VH } from '../channel-view/text/helpers';
import { useMessageAuthorName } from '../channel-view/text/hooks/use-message-author-name';
import { TextFileTabs } from '../channel-view/text/text-file-tabs';
import { UsersTypingIndicator } from '../channel-view/text/users-typing';
import { useFileAwareHeight } from './hooks';

type TMessageComposeProps = {
  channelId: number;
  message: string;
  onMessageChange: (value: string) => void;
  onSend: (message: string, files: TTempFile[]) => Promise<boolean>;
  editingMessage?: TJoinedMessage;
  onSaveEdit?: (
    message: TJoinedMessage,
    content: string,
    files: TMessageComposeFile[]
  ) => Promise<boolean>;
  onCancelEdit?: () => void;
  onTyping: () => void;
  typingUsers: TJoinedPublicUser[];
  showPluginSlot?: boolean;
  composeContainerRef?: RefObject<HTMLDivElement | null>;
  inputStorageKey?: LocalStorageKey;
  inputDefaultMaxHeightVh?: number;
  replyTarget?: TReplyTarget;
  onCancelReply?: () => void;
  onArrowUp?: () => void;
  onResize?: () => void;
  isThread?: boolean;
  ref?: Ref<TMessageComposeHandle>;
};

type TMessageComposeHandle = {
  clearFiles: () => void;
  discardFiles: () => void;
  focus: () => void;
};

type TMessageComposeFile =
  | {
      type: 'existing';
      id: number;
      name: string;
    }
  | {
      type: 'temporary';
      id: string;
      name: string;
    };

const getRenamedExistingFileName = (file: TFile, name: string) =>
  getFileNameWithLockedExtension(file.originalName, file.extension, name);

const MessageCompose = memo(
  ({
    channelId,
    message,
    onMessageChange,
    onSend,
    editingMessage,
    onSaveEdit,
    onCancelEdit,
    onTyping,
    typingUsers,
    showPluginSlot = false,
    composeContainerRef,
    inputStorageKey = LocalStorageKey.CHAT_INPUT_HEIGHT_VH,
    inputDefaultMaxHeightVh = DEFAULT_MAX_HEIGHT_VH,
    replyTarget,
    onCancelReply,
    onArrowUp,
    onResize,
    isThread = false,
    ref
  }: TMessageComposeProps) => {
    const { t } = useTranslation('common');
    const sendingRef = useRef(false);
    const internalContainerRef = useRef<HTMLDivElement | null>(null);
    const containerRef = composeContainerRef ?? internalContainerRef;
    const tiptapRef = useRef<TTiptapInputHandle>(null);
    const [sending, setSending] = useState(false);
    const [editingFiles, setEditingFiles] = useState<TFile[]>([]);
    const [attachmentLayoutVersion, setAttachmentLayoutVersion] = useState(0);
    const can = useCan();
    const channelCan = useChannelCan(channelId);
    const channel = useChannelById(channelId);
    const publicSettings = usePublicServerSettings();
    const allPluginCommands = useFlatPluginCommands();
    const replyAuthorName = useMessageAuthorName({
      userId: replyTarget?.userId ?? 0,
      pluginId: replyTarget?.pluginId ?? ''
    });

    const canSendMessages = useMemo(() => {
      return (
        can(Permission.SEND_MESSAGES) &&
        channelCan(ChannelPermission.SEND_MESSAGES)
      );
    }, [can, channelCan]);

    const canUploadFiles = useMemo(() => {
      const canShareFilesInDm =
        !channel?.isDm || !!publicSettings?.storageFileSharingInDirectMessages;

      return (
        can(Permission.SEND_MESSAGES) &&
        can(Permission.UPLOAD_FILES) &&
        channelCan(ChannelPermission.SEND_MESSAGES) &&
        canShareFilesInDm
      );
    }, [can, channelCan, channel, publicSettings]);

    const placeholder = useMemo(() => {
      if (channel && !isThread && !channel.isDm) {
        return t('messageChannel', { name: channel.name });
      }
      return t('typeAMessage');
    }, [channel, isThread, t]);

    const pluginCommands = useMemo(
      () => (can(Permission.USE_PLUGINS) ? allPluginCommands : undefined),
      [can, allPluginCommands]
    );

    const {
      files,
      displayItems,
      removeFile,
      renameFile,
      clearFiles,
      uploading,
      uploadingSize,
      uploadSpeed,
      openFileDialog,
      fileInputProps
    } = useUploadFiles(
      channelId,
      containerRef,
      !canSendMessages
    );

    const editingDisplayItems = useMemo<TDisplayItem[]>(
      () =>
        editingFiles.map((file) => ({
          id: `existing-${file.id}`,
          name: file.originalName,
          size: file.size,
          extension: file.extension,
          mimeType: file.mimeType,
          previewUrl: getFileUrl(file),
          existingFile: file
        })),
      [editingFiles]
    );
    const composeDisplayItems = useMemo(
      () => [...editingDisplayItems, ...displayItems],
      [displayItems, editingDisplayItems]
    );

    useFileAwareHeight({
      containerRef,
      composeContainerRef,
      displayItems: composeDisplayItems,
      layoutVersion: attachmentLayoutVersion,
      inputStorageKey,
      inputDefaultMaxHeightVh
    });

    const discardFiles = useCallback(() => {
      const trpc = getTRPCClient();

      for (const file of files) {
        trpc.files.deleteTemporary.mutate({ fileId: file.id }).catch(() => {
          // ignore cleanup errors
        });
      }

      clearFiles();
    }, [clearFiles, files]);

    useImperativeHandle(
      ref,
      () => ({
        clearFiles,
        discardFiles,
        focus: () => tiptapRef.current?.focus()
      }),
      [clearFiles, discardFiles]
    );

    const uploadedFileCount = files.length + editingFiles.length;
    const hasSendableContent =
      !isEmptyMessage(message) || uploadedFileCount > 0;
    const canSubmitMessage =
      hasSendableContent && canSendMessages && !uploading && !sending;

    useEffect(() => {
      setEditingFiles(editingMessage?.files ?? []);

      if (editingMessage) {
        onMessageChange(editingMessage.content ?? '');
      }
    }, [editingMessage, onMessageChange]);

    const handleCancelEdit = useCallback(() => {
      discardFiles();
      setEditingFiles([]);
      onCancelEdit?.();
    }, [discardFiles, onCancelEdit]);

    const handleSend = useCallback(async () => {
      if (!hasSendableContent || !canSendMessages || sendingRef.current) {
        return;
      }

      setSending(true);
      sendingRef.current = true;

      const filesToSend = files;
      const filesToSave: TMessageComposeFile[] = [
        ...editingFiles.map((file) => ({
          type: 'existing' as const,
          id: file.id,
          name: file.originalName
        })),
        ...filesToSend.map((file) => ({
          type: 'temporary' as const,
          id: file.id,
          name: file.originalName
        }))
      ];

      const success =
        editingMessage && onSaveEdit
          ? await onSaveEdit(editingMessage, message, filesToSave)
          : await onSend(message, filesToSend);

      sendingRef.current = false;
      setSending(false);

      if (success) {
        clearFiles();
        setEditingFiles([]);

        // if we were pinned down to the min then unpin now
        const el = containerRef.current;

        if (el?.dataset.pendingUnpinOnSend) {
          el.style.height = '';
          el.style.maxHeight = `${inputDefaultMaxHeightVh}vh`;

          delete el.dataset.pendingUnpinOnSend;
        }
      }
    }, [
      message,
      files,
      editingFiles,
      editingMessage,
      hasSendableContent,
      canSendMessages,
      onSend,
      onSaveEdit,
      clearFiles,
      containerRef,
      inputDefaultMaxHeightVh
    ]);

    const onRemoveFileClick = useCallback(
      async (fileId: string) => {
        removeFile(fileId);

        const trpc = getTRPCClient();

        try {
          trpc.files.deleteTemporary.mutate({ fileId });
        } catch {
          // ignore error
        }
      },
      [removeFile]
    );

    const removeComposeFile = useCallback(
      (item: TDisplayItem) => {
        if (item.existingFile) {
          setEditingFiles((current) =>
            current.filter((file) => file.id !== item.existingFile!.id)
          );
          return;
        }

        if (item.file) {
          void onRemoveFileClick(item.file.id);
        }
      },
      [onRemoveFileClick]
    );

    const renameComposeFile = useCallback(
      (item: TDisplayItem, name: string) => {
        if (item.existingFile) {
          setEditingFiles((current) =>
            current.map((file) =>
              file.id === item.existingFile!.id
                ? {
                    ...file,
                    originalName: getRenamedExistingFileName(file, name)
                  }
                : file
            )
          );
          return;
        }

        if (item.file) {
          renameFile(item.file.id, name);
        }
      },
      [renameFile]
    );

    const composeAttachmentFiles = useMemo(
      () =>
        composeDisplayItems.map((item) => ({
          key: item.id,
          originalName: item.name,
          size: item.size,
          extension: item.extension,
          mimeType: item.mimeType,
          href: item.existingFile ? getFileUrl(item.existingFile) : item.previewUrl,
          previewUrl: item.previewUrl,
          sourceFile: item.sourceFile,
          progress: item.progress,
          onRemove:
            item.existingFile || item.file
              ? () => removeComposeFile(item)
              : undefined,
          onRename:
            item.existingFile || item.file
              ? (name: string) => renameComposeFile(item, name)
              : undefined
        })),
      [composeDisplayItems, removeComposeFile, renameComposeFile]
    );
    const requestAttachmentLayout = useCallback(() => {
      setAttachmentLayoutVersion((version) => version + 1);
    }, []);

    useEffect(() => {
      // focus the input when user clicks on reply
      if (replyTarget) {
        tiptapRef.current?.focus();
      }
    }, [replyTarget]);

    // TODO: check if this is really necessary
    useEffect(() => {
      if (!onResize) return;

      const el = containerRef.current;

      if (!el) return;

      const observer = new ResizeObserver(onResize);

      observer.observe(el);

      return () => observer.disconnect();
    }, [onResize, containerRef]);

    return (
      <div
        ref={containerRef}
        className="compose-container relative shrink-0 min-h-14 flex flex-col pb-[env(safe-area-inset-bottom)] bg-white/[0.03]"
      >
        <UsersTypingIndicator typingUsers={typingUsers} />

        <div
          className={`compose-scroll-row flex flex-col flex-1 overflow-y-auto cursor-text${uploading ? ' bg-muted' : ''}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              tiptapRef.current?.focus();
            }
          }}
        >
          <div className="flex flex-1 flex-col">
            {editingMessage && (
              <div className="mx-2 mt-3 flex items-center justify-between rounded-md border border-border/60 bg-secondary/40 px-2 py-1 text-xs">
                <div className="min-w-0 flex items-center gap-1.5 text-muted-foreground">
                  <Pencil className="h-3.5 w-3.5 shrink-0" />
                  <span>{t('editMessage')}</span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  onClick={handleCancelEdit}
                  title={t('cancel')}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            {!editingMessage && replyTarget && (
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-secondary/40 mx-2 mt-3 px-2 py-1 text-xs">
                <div className="min-w-0 flex items-center gap-1.5 text-muted-foreground">
                  <Reply className="h-3.5 w-3.5 shrink-0" />
                  <span>{t('replyingTo', { username: replyAuthorName })}</span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  onClick={onCancelReply}
                  title={t('cancelReply')}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            {uploading && (
              <div className="flex items-center gap-2 px-2 pt-2">
                <div className="text-xs text-muted-foreground mb-1">
                  {t('uploadingFiles', { size: filesize(uploadingSize) })}
                  {uploadSpeed > 0 && ` - ${filesize(uploadSpeed)}/s`}
                </div>
                <Spinner size="xxs" />
              </div>
            )}
            {composeAttachmentFiles.length > 0 && (
              <div className="message-attachments flex w-fit max-w-full flex-wrap items-start gap-2 px-3 pt-3 [&:has([data-attachment-expanded=true])]:w-full">
                <TextFileTabs
                  files={composeAttachmentFiles}
                  context="compose"
                  onLayoutChange={requestAttachmentLayout}
                />
              </div>
            )}
            <TiptapInput
              ref={tiptapRef}
              value={message}
              placeholder={placeholder}
              onChange={onMessageChange}
              onSubmit={handleSend}
              onTyping={onTyping}
              onArrowUp={onArrowUp}
              disabled={uploading || !canSendMessages}
              readOnly={sending}
              commands={pluginCommands}
            />
          </div>

          <input {...fileInputProps} />
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 rounded-full bg-transparent hover:bg-transparent hover:text-foreground"
                disabled={uploading || !canUploadFiles}
                onClick={() => openFileDialog('*')}
                title={t('insertAttachment')}
              >
                <Plus className="h-5 w-5" />
              </Button>

              <EmojiPicker
                onEmojiSelect={(emoji) => tiptapRef.current?.insertEmoji(emoji)}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={uploading || !canSendMessages}
                >
                  <Smile className="h-5 w-5" />
                </Button>
              </EmojiPicker>

              {showPluginSlot && (
                <PluginSlotRenderer slotId={PluginSlot.CHAT_ACTIONS} />
              )}
            </div>

            <div className="flex shrink-0 items-center">
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 bg-transparent text-muted-foreground hover:bg-transparent hover:text-foreground disabled:bg-transparent"
                onClick={handleSend}
                title={editingMessage ? t('saveChanges') : undefined}
                disabled={!canSubmitMessage}
              >
                {editingMessage ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <SendHorizontal
                    className="h-5 w-5"
                    fill={canSubmitMessage ? 'currentColor' : 'none'}
                  />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

export { MessageCompose, type TMessageComposeFile, type TMessageComposeHandle };

import {
  closeClaudeCodeHistoryPanel,
  closeClaudeCodePanel,
  openClaudeCodeHistoryPanel
} from '@/features/app/actions';
import { useClaudeCodeHistoryOpen } from '@/features/app/hooks';
import { useChannelById } from '@/features/server/channels/hooks';
import { useOwnUserId, useUserById } from '@/features/server/users/hooks';
import { getTRPCClient } from '@/lib/trpc';
import { ChannelType } from '@mikotord/shared';
import { IconButton, Tooltip } from '@mikotord/ui';
import { AtSign, Hash, History, Plus, Users, X } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

type TTextTopbarProps = {
  channelId: number;
  onClose?: () => void;
  onToggleMembers?: () => void;
};

const TextTopbar = memo(
  ({ channelId, onClose, onToggleMembers }: TTextTopbarProps) => {
    const { t } = useTranslation();
    const { t: tSidebar } = useTranslation('sidebar');
    const channel = useChannelById(channelId);
    const ownUserId = useOwnUserId();
    const claudeCodeHistoryOpen = useClaudeCodeHistoryOpen();
    const [creatingClaudeCodeSession, setCreatingClaudeCodeSession] =
      useState(false);

    const dmUserId = useMemo(() => {
      if (!channel?.isDm || !ownUserId) return null;

      const match = /^DM - (\d+):(\d+)$/.exec(channel.name);
      if (!match) return null;

      const userIds = [Number(match[1]), Number(match[2])];

      return userIds.find((id) => id !== ownUserId) ?? null;
    }, [channel, ownUserId]);

    const dmUser = useUserById(dmUserId);
    const isClaudeCodeDm = channel?.isDm && dmUser?.name === 'ClaudeCode';

    const info = useMemo(() => {
      if (channel?.isDm) {
        return {
          name: dmUser?.name ?? t('directMessage')
        };
      }

      return {
        name: channel?.name
      };
    }, [channel, dmUser?.name, t]);

    const getIcon = useCallback(() => {
      if (channel?.isDm) {
        return (
          <AtSign className="inline-block text-muted-foreground h-4 w-4" />
        );
      }

      if (channel?.type === ChannelType.TEXT) {
        return <Hash className="inline-block text-muted-foreground h-4 w-4" />;
      }

      return null;
    }, [channel]);

    const startNewClaudeCodeSession = useCallback(async () => {
      if (creatingClaudeCodeSession) return;

      const toastId = toast.loading('正在启动 ClaudeCode 新会话...');

      setCreatingClaudeCodeSession(true);

      try {
        await getTRPCClient().agents.startNewClaudeCodeSession.mutate();
        closeClaudeCodeHistoryPanel();
        closeClaudeCodePanel();
        toast.success('已新建 ClaudeCode 会话，聊天室已清空');
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : '新建 ClaudeCode 会话失败'
        );
      } finally {
        toast.dismiss(toastId);
        setCreatingClaudeCodeSession(false);
      }
    }, [creatingClaudeCodeSession]);

    const openClaudeCodeHistory = useCallback(() => {
      closeClaudeCodePanel();

      if (claudeCodeHistoryOpen) {
        closeClaudeCodeHistoryPanel();
      } else {
        openClaudeCodeHistoryPanel();
      }
    }, [claudeCodeHistoryOpen]);

    return (
      <div className="flex h-12 border-b border-border bg-card w-auto overflow-hidden">
        <div className="flex w-full items-center justify-between px-4">
          <div className="flex items-center gap-2 min-w-0">
            {getIcon()}
            <span className="font-bold truncate max-w-40">{info.name}</span>
          </div>
          <div className="flex items-center gap-4">
            {isClaudeCodeDm && (
              <Tooltip content="新建 ClaudeCode 会话">
                <IconButton
                  aria-label="新建 ClaudeCode 会话"
                  icon={Plus}
                  variant="ghost"
                  size="sm"
                  disabled={creatingClaudeCodeSession}
                  onClick={startNewClaudeCodeSession}
                />
              </Tooltip>
            )}
            {isClaudeCodeDm && (
              <Tooltip content="历史 ClaudeCode 会话">
                <span className="ml-2 inline-flex items-center">
                  <IconButton
                    aria-label="历史 ClaudeCode 会话"
                    icon={History}
                    variant="ghost"
                    size="sm"
                    onClick={openClaudeCodeHistory}
                  />
                </span>
              </Tooltip>
            )}
            {onToggleMembers && !channel?.isDm && (
              <Tooltip content={tSidebar('members')}>
                <IconButton
                  aria-label={tSidebar('members')}
                  icon={Users}
                  variant="ghost"
                  size="sm"
                  onClick={onToggleMembers}
                />
              </Tooltip>
            )}
            {onClose && (
              <IconButton
                onClick={onClose}
                icon={X}
                variant="ghost"
                size="sm"
              />
            )}
          </div>
        </div>
      </div>
    );
  }
);

export { TextTopbar };

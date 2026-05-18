import { TypingDots } from '@/components/typing-dots';
import {
  useChannelById,
  useChannelsByCategoryId,
  useSelectedChannelId
} from '@/features/server/channels/hooks';
import {
  useCan,
  useChannelCan,
  useHasUnreadMentions,
  useTypingUsersByChannelId,
  useUnreadMessagesCount
} from '@/features/server/hooks';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChannelPermission,
  Permission,
  type TChannel,
  TestId,
  getTrpcError
} from '@mikotord/shared';
import { Hash } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChannelContextMenu } from '../context-menus/channel';
import { UnreadCount } from '../unread-count';
import { useSelectChannel } from './hooks';

type TTextProps = Omit<TItemWrapperProps, 'children'> & {
  channel: TChannel;
};

const Text = memo(({ channel, ...props }: TTextProps) => {
  const typingUsers = useTypingUsersByChannelId(channel.id);
  const unreadCount = useUnreadMessagesCount(channel.id);
  const hasUnreadMessages = useHasUnreadMentions(channel.id);
  const hasTypingUsers = typingUsers.length > 0;

  return (
    <ItemWrapper {...props}>
      <Hash className="h-4 w-4" />
      <span className="flex-1">{channel.name}</span>
      {hasTypingUsers && (
        <div className="flex items-center gap-0.5 ml-auto">
          <TypingDots className="space-x-0.5" />
        </div>
      )}
      {!hasTypingUsers && unreadCount > 0 && (
        <UnreadCount count={unreadCount} hasMention={hasUnreadMessages} />
      )}
    </ItemWrapper>
  );
});

type TItemWrapperProps = {
  children: React.ReactNode;
  className?: string;
  isSelected: boolean;
  onClick: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  style?: React.CSSProperties;
  disabled?: boolean;
};

const ItemWrapper = memo(
  ({
    children,
    isSelected,
    onClick,
    className,
    dragHandleProps,
    style,
    disabled = false
  }: TItemWrapperProps) => {
    return (
      <div
        {...dragHandleProps}
        data-testid={TestId.CHANNEL_ITEM}
        style={style}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground select-none cursor-pointer',
          {
            'bg-accent text-accent-foreground': isSelected,
            'cursor-default opacity-50 hover:bg-transparent hover:text-muted-foreground':
              disabled
          },
          className
        )}
        onClick={disabled ? undefined : onClick}
      >
        {children}
      </div>
    );
  }
);

type TChannelProps = {
  channelId: number;
  isSelected: boolean;
  onClick: () => void;
};

const Channel = memo(({ channelId, isSelected, onClick }: TChannelProps) => {
  const channel = useChannelById(channelId);
  const channelCan = useChannelCan(channelId);
  const can = useCan();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: channelId });

  if (!channel) {
    return null;
  }

  if (
    !channelCan(ChannelPermission.VIEW_CHANNEL) &&
    !can(Permission.MANAGE_CHANNELS)
  ) {
    return null;
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform && { ...transform, x: 0 }),
        transition,
        opacity: isDragging ? 0.5 : 1
      }}
    >
      <ChannelContextMenu channelId={channelId}>
        <div>
          {channel.type === 'TEXT' && (
            <Text
              channel={channel}
              isSelected={isSelected}
              onClick={onClick}
              dragHandleProps={{ ...attributes, ...listeners }}
            />
          )}
        </div>
      </ChannelContextMenu>
    </div>
  );
});

type TChannelsProps = {
  categoryId: number;
  query?: string;
};

const Channels = memo(({ categoryId, query = '' }: TChannelsProps) => {
  const { t } = useTranslation('sidebar');
  const normalizedQuery = query.trim().toLowerCase();
  const channels = useChannelsByCategoryId(categoryId).filter((channel) => {
    if (channel.type !== 'TEXT') return false;
    if (!normalizedQuery) return true;

    return channel.name.toLowerCase().includes(normalizedQuery);
  });
  const selectedChannelId = useSelectedChannelId();
  const can = useCan();
  const channelIds = useMemo(
    () => channels.map((channel) => channel.id),
    [channels]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8
      }
    })
  );

  const onChannelClick = useSelectChannel();

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || active.id === over.id) {
        return;
      }

      const oldIndex = channelIds.indexOf(active.id as number);
      const newIndex = channelIds.indexOf(over.id as number);

      if (oldIndex === -1 || newIndex === -1) {
        return;
      }

      const reorderedIds = [...channelIds];
      const [movedId] = reorderedIds.splice(oldIndex, 1);

      reorderedIds.splice(newIndex, 0, movedId);

      try {
        const trpc = getTRPCClient();

        await trpc.channels.reorder.mutate({
          categoryId,
          channelIds: reorderedIds
        });
      } catch (error) {
        toast.error(getTrpcError(error, t('failedReorderChannels')));
      }
    },
    [categoryId, channelIds, t]
  );

  return (
    <div className="space-y-0.5">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={channelIds}
          strategy={verticalListSortingStrategy}
          disabled={!can(Permission.MANAGE_CHANNELS) || !!normalizedQuery}
        >
          {channels.map((channel) => (
            <Channel
              key={channel.id}
              channelId={channel.id}
              isSelected={selectedChannelId === channel.id}
              onClick={() => onChannelClick(channel.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
});

export { Channels };

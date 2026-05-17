import { TextChannel } from '@/components/channel-view/text';
import { PluginSlotRenderer } from '@/components/plugin-slot-renderer';
import {
  useSelectedChannelId,
  useSelectedChannelType
} from '@/features/server/channels/hooks';
import {
  useActiveFullscreenPluginId,
} from '@/features/server/hooks';
import { ChannelType, PluginSlot } from '@mikotord/shared';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

type TContentWrapperProps = {
  isDmMode: boolean;
  selectedDmChannelId?: number;
  onToggleMembers?: () => void;
};

const ContentWrapper = memo(
  ({
    isDmMode,
    selectedDmChannelId,
    onToggleMembers
  }: TContentWrapperProps) => {
    const { t } = useTranslation();
    const selectedChannelId = useSelectedChannelId();
    const selectedChannelType = useSelectedChannelType();
    const activeFullscreenPluginId = useActiveFullscreenPluginId();

    if (activeFullscreenPluginId) {
      return (
        <main className="flex flex-1 flex-col bg-background relative min-w-0 min-h-0">
          <div className="flex-col gap-2 h-full w-full flex overflow-auto relative bg-background">
            <PluginSlotRenderer
              slotId={PluginSlot.FULL_SCREEN}
              activeFullscreenPluginId={activeFullscreenPluginId}
            />
          </div>
        </main>
      );
    }

    let content;

    if (isDmMode) {
      if (selectedDmChannelId) {
        content = (
          <TextChannel
            key={selectedDmChannelId}
            channelId={selectedDmChannelId}
            onToggleMembers={onToggleMembers}
          />
        );
      } else {
        content = (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t('selectDmPrompt')}
          </div>
        );
      }

      return (
        <main className="flex flex-1 flex-col bg-background relative min-w-0 min-h-0">
          {content}
        </main>
      );
    }

    if (selectedChannelId) {
      if (selectedChannelType === ChannelType.TEXT) {
        content = (
          <TextChannel
            key={selectedChannelId}
            channelId={selectedChannelId}
            onToggleMembers={onToggleMembers}
          />
        );
      }
    } else {
      content = (
        <div className="flex-col gap-2 h-full w-full flex overflow-auto">
          <PluginSlotRenderer slotId={PluginSlot.HOME_SCREEN} />
        </div>
      );
    }

    return (
      <main className="flex flex-1 flex-col bg-background relative min-w-0 min-h-0">
        {content}
      </main>
    );
  }
);

export { ContentWrapper };

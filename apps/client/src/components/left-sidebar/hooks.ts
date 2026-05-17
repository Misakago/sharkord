import { useAutoJoinLastChannel } from '@/features/app/hooks';
import { setSelectedChannelId } from '@/features/server/channels/actions';
import { useChannelsMap } from '@/features/server/channels/hooks';
import { getLocalStorageItemAsJSON, LocalStorageKey } from '@/helpers/storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

const loadExpandedValue = (categoryId: number): boolean => {
  const expandedMap = getLocalStorageItemAsJSON<Record<number, boolean>>(
    LocalStorageKey.CATEGORIES_EXPANDED,
    {}
  );

  return expandedMap?.[categoryId] ?? true;
};

const saveExpandedValue = (categoryId: number, expanded: boolean): void => {
  const expandedMap = getLocalStorageItemAsJSON<Record<number, boolean>>(
    LocalStorageKey.CATEGORIES_EXPANDED,
    {}
  );

  const newExpandedMap = {
    ...expandedMap,
    [categoryId]: expanded
  };

  localStorage.setItem(
    LocalStorageKey.CATEGORIES_EXPANDED,
    JSON.stringify(newExpandedMap)
  );
};

const useCategoryExpanded = (categoryId: number) => {
  const [expanded, setExpanded] = useState(loadExpandedValue(categoryId));

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const newValue = !prev;

      saveExpandedValue(categoryId, newValue);

      return newValue;
    });
  }, [categoryId]);

  return useMemo(
    () => ({ expanded, toggleExpanded }),
    [expanded, toggleExpanded]
  );
};

const useSelectChannel = () => {
  const autoJoinLastChannel = useAutoJoinLastChannel();
  const channelsMap = useChannelsMap();

  const selectChannel = useCallback(
    async (channelId: number) => {
      const channel = channelsMap[channelId];

      if (!channel) return;

      setSelectedChannelId(channel.id);

      localStorage.setItem(
        LocalStorageKey.LAST_SELECTED_CHANNEL,
        channel.id.toString()
      );
    },
    [channelsMap]
  );

  useEffect(() => {
    if (!autoJoinLastChannel) return;

    const lastSelectedChannelId = localStorage.getItem(
      LocalStorageKey.LAST_SELECTED_CHANNEL
    );

    if (lastSelectedChannelId) {
      const channelId = parseInt(lastSelectedChannelId, 10);
      const lastChannel = channelsMap[channelId];

      if (lastChannel) {
        setSelectedChannelId(channelId);
      }
    }
  }, [channelsMap, autoJoinLastChannel]);

  return selectChannel;
};

export { useCategoryExpanded, useSelectChannel };

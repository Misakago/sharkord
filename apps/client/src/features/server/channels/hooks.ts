import type { IRootState } from '@/features/store';
import { useSelector } from 'react-redux';
import {
  channelByIdSelector,
  channelIdsSelector,
  channelPermissionsByIdSelector,
  channelsByCategoryIdSelector,
  channelsMapSelector,
  channelsSelector,
  directMessagesUnreadCountSelector,
  selectedChannelIdSelector,
  selectedChannelSelector,
  selectedChannelTypeSelector
} from './selectors';

export const useChannels = () =>
  useSelector((state: IRootState) => channelsSelector(state));

export const useChannelById = (channelId: number) =>
  useSelector((state: IRootState) => channelByIdSelector(state, channelId));

export const useChannelsByCategoryId = (categoryId: number) =>
  useSelector((state: IRootState) =>
    channelsByCategoryIdSelector(state, categoryId)
  );

export const useSelectedChannelId = () =>
  useSelector(selectedChannelIdSelector);

export const useSelectedChannel = () => useSelector(selectedChannelSelector);

export const useChannelPermissionsById = (channelId: number) =>
  useSelector((state: IRootState) =>
    channelPermissionsByIdSelector(state, channelId)
  );

export const useSelectedChannelType = () =>
  useSelector(selectedChannelTypeSelector);

export const useChannelsMap = () => useSelector(channelsMapSelector);

export const useChannelIds = () => useSelector(channelIdsSelector);

export const useDirectMessagesUnreadCount = () =>
  useSelector(directMessagesUnreadCountSelector);

import { Dialog } from '@/components/dialogs/dialogs';
import { openDialog } from '@/features/dialogs/actions';
import { useCategories } from '@/features/server/categories/hooks';
import { useChannels } from '@/features/server/channels/hooks';
import {
  useCan,
  useHasVisibleChannelsInCategory
} from '@/features/server/hooks';
import { Permission } from '@mikotord/shared';
import { IconButton, Input, Tooltip } from '@mikotord/ui';
import { Plus, Search, X } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CategoryContextMenu } from '../context-menus/category';
import { Channels } from './channels';

type TCategoryProps = {
  showHeader: boolean;
  categoryId: number;
  query?: string;
};

const Category = memo(({ categoryId, showHeader, query }: TCategoryProps) => {
  const { t } = useTranslation('sidebar');
  const can = useCan();
  const hasVisibleChannelsInCategory =
    useHasVisibleChannelsInCategory(categoryId);
  const categories = useCategories();
  const category = categories.find((item) => item.id === categoryId);

  if (
    !hasVisibleChannelsInCategory &&
    !can([Permission.MANAGE_CHANNELS, Permission.MANAGE_CATEGORIES])
  ) {
    return null;
  }

  return (
    <div className="space-y-1">
      {showHeader && category && (
        <CategoryContextMenu categoryId={categoryId}>
          <div className="flex h-8 items-center justify-between rounded px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="truncate">{category.name}</span>
            {can(Permission.MANAGE_CHANNELS) && (
              <Tooltip content={t('createChannel')}>
                <IconButton
                  size="sm"
                  variant="ghost"
                  icon={Plus}
                  className="h-6 w-6 shrink-0"
                  onClick={() =>
                    openDialog(Dialog.CREATE_CHANNEL, { categoryId })
                  }
                />
              </Tooltip>
            )}
          </div>
        </CategoryContextMenu>
      )}
      <Channels categoryId={categoryId} query={query} />
    </div>
  );
});

const Categories = memo(() => {
  const { t } = useTranslation('sidebar');
  const categories = useCategories();
  const channels = useChannels();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const defaultCategoryId = categories[0]?.id;
  const filteredCategories = useMemo(() => {
    if (!searchOpen || !normalizedQuery) return categories;

    const matchingCategoryIds = new Set(
      channels
        .filter(
          (channel) =>
            !channel.isDm &&
            channel.type === 'TEXT' &&
            channel.categoryId &&
            channel.name.toLowerCase().includes(normalizedQuery)
        )
        .map((channel) => channel.categoryId)
    );

    return categories.filter((category) =>
      matchingCategoryIds.has(category.id)
    );
  }, [categories, channels, normalizedQuery, searchOpen]);
  const shouldShowHeaders =
    searchOpen ||
    filteredCategories.length > 1 ||
    filteredCategories.some((category) => category.name !== 'Text Channels');

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
  }, []);

  return (
    <div className="h-full overflow-y-auto p-2">
      <div className="mb-1 flex items-center justify-between px-2 py-1">
        <IconButton
          variant="ghost"
          size="sm"
          icon={searchOpen ? X : Search}
          title={searchOpen ? t('close') : t('searchGroups')}
          onClick={() => {
            if (searchOpen) {
              closeSearch();
            } else {
              setSearchOpen(true);
            }
          }}
        />
        <IconButton
          variant="ghost"
          size="sm"
          icon={Plus}
          title={t('addCategory')}
          disabled={!defaultCategoryId}
          onClick={() => {
            if (!defaultCategoryId) return;

            openDialog(Dialog.CREATE_CHANNEL, {
              categoryId: defaultCategoryId,
              defaultName: '',
              isGroupChat: true
            });
          }}
        />
      </div>

      {searchOpen && (
        <div className="mb-2 px-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchGroups')}
            autoFocus
          />
        </div>
      )}

      <div className="space-y-3">
        {filteredCategories.map((category) => (
          <Category
            key={category.id}
            categoryId={category.id}
            showHeader={shouldShowHeaders}
            query={searchOpen ? normalizedQuery : ''}
          />
        ))}
        {searchOpen &&
          normalizedQuery.length > 0 &&
          filteredCategories.length === 0 && (
            <div className="px-2 py-4 text-xs text-muted-foreground">
              {t('noGroupsAvailable')}
            </div>
          )}
      </div>
    </div>
  );
});

export { Categories };

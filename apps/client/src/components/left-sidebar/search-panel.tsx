import { jumpToMessage } from '@/features/server/actions';
import { Input } from '@mikotord/ui';
import { AtSign, FileText, Hash } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearch } from '../dialogs/search/hooks';
import { SearchResultFileCard } from '../dialogs/search/search-result-file';
import { SearchResultMessageCard } from '../dialogs/search/search-result-message';
import type { TUnifiedSearchResult } from '../dialogs/search/types';

type TSearchPanelProps = {
  active: boolean;
  onOpenResult: () => void;
};

const SearchPanel = memo(({ active, onOpenResult }: TSearchPanelProps) => {
  const { t } = useTranslation('dialogs');
  const { query, setQuery, canSearch, unifiedResults } = useSearch(active);

  const handleJump = useCallback(
    (target: Parameters<typeof jumpToMessage>[0]) => {
      jumpToMessage(target);
    },
    []
  );

  const handleOpen = useCallback(
    (target: Parameters<typeof jumpToMessage>[0]) => {
      jumpToMessage(target);
      onOpenResult();
    },
    [onOpenResult]
  );

  const groupedResults = useMemo(
    () => [
      {
        key: 'groups',
        title: t('searchGroupResults'),
        icon: Hash,
        items: unifiedResults.filter(
          (entry) => entry.type === 'message' && !entry.item.channelIsDm
        )
      },
      {
        key: 'dms',
        title: t('searchDirectMessageResults'),
        icon: AtSign,
        items: unifiedResults.filter(
          (entry) => entry.type === 'message' && entry.item.channelIsDm
        )
      },
      {
        key: 'files',
        title: t('searchFileResults'),
        icon: FileText,
        items: unifiedResults.filter((entry) => entry.type === 'file')
      }
    ].filter((group) => group.items.length > 0),
    [t, unifiedResults]
  );

  const renderResult = useCallback(
    (entry: TUnifiedSearchResult) => {
      if (entry.type === 'message') {
        return (
          <SearchResultMessageCard
            key={entry.key}
            message={entry.item}
            onJump={handleJump}
            onOpen={handleOpen}
          />
        );
      }

      return (
        <SearchResultFileCard
          key={entry.key}
          result={entry.item}
          onJump={handleJump}
          onOpen={handleOpen}
        />
      );
    },
    [handleJump, handleOpen]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
          autoFocus
          className="h-9"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-0">
        {canSearch && unifiedResults.length === 0 && (
          <div className="flex min-h-32 items-center justify-center px-4 text-sm text-muted-foreground">
            {t('noResults')}
          </div>
        )}

        {canSearch && groupedResults.length > 0 && (
          <div className="space-y-4">
            {groupedResults.map((group) => {
              const Icon = group.icon;

              return (
                <section key={group.key} className="space-y-2">
                  <div className="flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" />
                    <span>{group.title}</span>
                  </div>
                  <div className="space-y-2">
                    {group.items.map(renderResult)}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

export { SearchPanel };

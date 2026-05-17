import type { TEmojiItem } from '@/components/tiptap-input/helpers';
import { Input, Popover, PopoverContent, PopoverTrigger } from '@mikotord/ui';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ALL_EMOJIS, searchEmojis } from './emoji-data';
import { EmojiGrid } from './emoji-grid';
import { NativeEmojiTab } from './native-emoji-tab';
import { useRecentEmojis } from './use-recent-emojis';

type TEmojiPickerProps = {
  children: React.ReactNode;
  onEmojiSelect: (emoji: TEmojiItem) => void;
};

const EmojiPicker = memo(({ children, onEmojiSelect }: TEmojiPickerProps) => {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { addRecent } = useRecentEmojis();

  const isSearching = search.trim().length > 0;

  const searchResults = useMemo(
    () => (isSearching ? searchEmojis(ALL_EMOJIS, search) : []),
    [isSearching, search]
  );

  const handleEmojiSelect = useCallback(
    (emoji: TEmojiItem) => {
      onEmojiSelect(emoji);
      setOpen(false);
    },
    [onEmojiSelect]
  );

  const handleSearchResultSelect = useCallback(
    (emoji: TEmojiItem) => {
      handleEmojiSelect(emoji);
      requestAnimationFrame(() => addRecent(emoji));
    },
    [handleEmojiSelect, addRecent]
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch('');
    }
  }, []);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-[320px] p-0 h-100"
        align="start"
        sideOffset={8}
      >
        <div className="h-full flex flex-col">
          <div className="p-3 border-b">
            <Input
              placeholder={t('searchAllEmojis')}
              value={search}
              onChange={handleSearchChange}
              className="h-9"
              autoFocus
            />
          </div>

          {isSearching ? (
            <div className="flex flex-col flex-1 min-h-0">
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
                {t('searchResults', { count: searchResults.length })}
              </div>
              <div className="flex-1 min-h-0">
                <EmojiGrid
                  emojis={searchResults}
                  onSelect={handleSearchResultSelect}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <NativeEmojiTab onEmojiSelect={handleEmojiSelect} />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});

EmojiPicker.displayName = 'EmojiPicker';

export { EmojiPicker };

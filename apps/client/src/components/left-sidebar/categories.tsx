import { Dialog } from '@/components/dialogs/dialogs';
import { openDialog } from '@/features/dialogs/actions';
import { useCategories } from '@/features/server/categories/hooks';
import {
  useCan,
  useHasVisibleChannelsInCategory
} from '@/features/server/hooks';
import { Permission } from '@mikotord/shared';
import { Button, IconButton, Tooltip } from '@mikotord/ui';
import { Plus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { CategoryContextMenu } from '../context-menus/category';
import { Channels } from './channels';

type TCategoryProps = {
  showHeader: boolean;
  categoryId: number;
};

const Category = memo(({ categoryId, showHeader }: TCategoryProps) => {
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
      <Channels categoryId={categoryId} />
    </div>
  );
});

const Categories = memo(() => {
  const { t } = useTranslation('sidebar');
  const categories = useCategories();
  const can = useCan();
  const shouldShowHeaders =
    categories.length > 1 ||
    categories.some((category) => category.name !== 'Text Channels');

  return (
    <div className="h-full overflow-y-auto p-2 space-y-3">
      {can(Permission.MANAGE_CATEGORIES) && (
        <Button
          variant="outline"
          className="h-9 w-full justify-start"
          onClick={() => openDialog(Dialog.CREATE_CATEGORY)}
        >
          <Plus className="h-4 w-4" />
          {t('addCategory')}
        </Button>
      )}
      {categories.map((category) => (
        <Category
          key={category.id}
          categoryId={category.id}
          showHeader={shouldShowHeaders}
        />
      ))}
    </div>
  );
});

export { Categories };

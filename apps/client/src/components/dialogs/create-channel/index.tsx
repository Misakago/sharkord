import { getTRPCClient } from '@/lib/trpc';
import {
  ChannelType,
  parseTrpcErrors,
  type TTrpcErrors
} from '@mikotord/shared';
import {
  AutoFocus,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Group,
  Input
} from '@mikotord/ui';
import { Hash } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TDialogBaseProps } from '../types';

type TCreateChannelDialogProps = TDialogBaseProps & {
  categoryId: number;
};

const CreateChannelDialog = memo(
  ({ isOpen, categoryId, close }: TCreateChannelDialogProps) => {
    const { t } = useTranslation('dialogs');
    const [name, setName] = useState('New Channel');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<TTrpcErrors>({});

    const onSubmit = useCallback(async () => {
      const trpc = getTRPCClient();

      setLoading(true);

      try {
        await trpc.channels.add.mutate({
          type: ChannelType.TEXT,
          name,
          categoryId
        });

        close();
      } catch (error) {
        setErrors(parseTrpcErrors(error));
      } finally {
        setLoading(false);
      }
    }, [name, categoryId, close]);

    return (
      <Dialog open={isOpen}>
        <DialogContent onInteractOutside={close} close={close}>
          <DialogHeader>
            <DialogTitle>{t('createChannelTitle')}</DialogTitle>
          </DialogHeader>

          <Group label={t('channelTypeLabel')}>
            <div className="flex items-center gap-2 rounded-md bg-primary/10 p-2 ring-2 ring-primary">
              <Hash className="h-6 w-6" />
              <div className="flex flex-col">
                <span>{t('textChannelTitle')}</span>
                <span className="text-sm text-primary/60">
                  {t('textChannelDesc')}
                </span>
              </div>
            </div>
          </Group>

          <Group label={t('channelNameLabel')}>
            <AutoFocus>
              <Input
                placeholder={t('channelNamePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                name="name"
                error={errors.name}
                resetError={setErrors}
                onEnter={onSubmit}
              />
            </AutoFocus>
          </Group>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={close}>
              {t('cancel')}
            </Button>
            <Button onClick={onSubmit} disabled={loading || !name}>
              {t('createChannelBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export { CreateChannelDialog };

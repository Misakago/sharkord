import {
  FileSaveType,
  getPlainTextFromHtml,
  Permission
} from '@mikotord/shared';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db';
import { removeFile } from '../../db/mutations/files';
import { publishMessage } from '../../db/publishers';
import { assertDmChannel, isDirectMessageChannel } from '../../db/queries/dms';
import { getSettings } from '../../db/queries/server';
import { files, messageFiles, messages } from '../../db/schema';
import { attachFileToken } from '../../helpers/files-crypto';
import { eventBus } from '../../plugins/event-bus';
import { fileManager } from '../../utils/file-manager';
import { invariant } from '../../utils/invariant';
import { protectedProcedure } from '../../utils/trpc';

const replaceMessageFileRoute = protectedProcedure
  .input(
    z.object({
      messageId: z.number(),
      fileId: z.number(),
      temporaryFileId: z.string(),
      name: z.string().min(1).max(255).optional()
    })
  )
  .mutation(async ({ input, ctx }) => {
    const message = await db
      .select({
        id: messages.id,
        userId: messages.userId,
        pluginId: messages.pluginId,
        channelId: messages.channelId,
        content: messages.content,
        editable: messages.editable
      })
      .from(messages)
      .where(eq(messages.id, input.messageId))
      .limit(1)
      .get();

    invariant(message, {
      code: 'NOT_FOUND',
      message: 'Message not found'
    });

    await assertDmChannel(message.channelId, ctx.userId);

    invariant(message.editable, {
      code: 'FORBIDDEN',
      message: 'This message is not editable'
    });

    invariant(
      message.userId === ctx.user.id ||
        (await ctx.hasPermission(Permission.MANAGE_MESSAGES)),
      {
        code: 'FORBIDDEN',
        message: 'You do not have permission to edit this message'
      }
    );

    const [fileLink, currentFile, settings] = await Promise.all([
      db
        .select()
        .from(messageFiles)
        .where(
          and(
            eq(messageFiles.messageId, input.messageId),
            eq(messageFiles.fileId, input.fileId)
          )
        )
        .limit(1)
        .get(),
      db.select().from(files).where(eq(files.id, input.fileId)).limit(1).get(),
      getSettings()
    ]);

    invariant(fileLink && currentFile, {
      code: 'BAD_REQUEST',
      message: 'File is not attached to this message'
    });

    invariant(settings.storageUploadEnabled, {
      code: 'FORBIDDEN',
      message: 'File uploads are disabled on this server'
    });

    const isDmChannel = await isDirectMessageChannel(message.channelId);

    if (isDmChannel) {
      invariant(settings.storageFileSharingInDirectMessages, {
        code: 'FORBIDDEN',
        message: 'File sharing in direct messages is disabled on this server'
      });
    }

    const newFile = await fileManager.saveFile(
      input.temporaryFileId,
      ctx.userId,
      FileSaveType.MESSAGE,
      input.name ?? currentFile.originalName
    );
    const now = Date.now();

    await db
      .update(messageFiles)
      .set({
        fileId: newFile.id,
        updatedAt: now
      })
      .where(
        and(
          eq(messageFiles.messageId, input.messageId),
          eq(messageFiles.fileId, input.fileId)
        )
      );

    await removeFile(input.fileId);

    await db
      .update(messages)
      .set({
        updatedAt: now,
        editedAt: now,
        editedBy: ctx.user.id
      })
      .where(eq(messages.id, input.messageId));

    publishMessage(input.messageId, message.channelId, 'update');

    eventBus.emit('message:updated', {
      messageId: input.messageId,
      channelId: message.channelId,
      userId: message.userId,
      pluginId: message.pluginId,
      content: message.content ?? '',
      textContent: getPlainTextFromHtml(message.content ?? '')
    });

    return attachFileToken(
      newFile,
      settings.storageSignedUrlsEnabled,
      settings.storageSignedUrlsTtlSeconds
    );
  });

export { replaceMessageFileRoute };

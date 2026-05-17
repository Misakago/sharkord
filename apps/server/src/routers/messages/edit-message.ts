import {
  FileSaveType,
  Permission,
  getPlainTextFromHtml,
  isEmptyMessage
} from '@mikotord/shared';
import { eq } from 'drizzle-orm';
import path from 'path';
import { z } from 'zod';
import { config } from '../../config';
import { db } from '../../db';
import { removeFile } from '../../db/mutations/files';
import { publishMessage } from '../../db/publishers';
import { assertDmChannel, isDirectMessageChannel } from '../../db/queries/dms';
import { getFilesByMessageId } from '../../db/queries/files';
import { getSettings } from '../../db/queries/server';
import { files, messageFiles, messages } from '../../db/schema';
import { sanitizeMessageHtml } from '../../helpers/sanitize-html';
import { eventBus } from '../../plugins/event-bus';
import { enqueueProcessMetadata } from '../../queues/message-metadata';
import { fileManager } from '../../utils/file-manager';
import { invariant } from '../../utils/invariant';
import { protectedProcedure, rateLimitedProcedure } from '../../utils/trpc';

const messageFileInput = z.union([
  z.object({
    type: z.literal('existing'),
    id: z.number(),
    name: z.string().min(1).max(255).optional()
  }),
  z.object({
    type: z.literal('temporary'),
    id: z.string(),
    name: z.string().min(1).max(255).optional()
  })
]);

const getRenamedOriginalName = (
  current: { originalName: string; extension: string },
  originalName?: string
) => {
  const trimmedName = originalName?.trim();

  if (!trimmedName) {
    return current.originalName;
  }

  const safeName = path.basename(trimmedName).replace(/[\0\r\n]/g, '');
  const baseName = path.basename(safeName, path.extname(safeName)).trim();

  if (!baseName) {
    return current.originalName;
  }

  return `${baseName}${current.extension}`;
};

const editMessageRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.sendAndEditMessage.maxRequests,
  windowMs: config.rateLimiters.sendAndEditMessage.windowMs,
  logLabel: 'editMessage'
})
  .input(
    z.object({
      messageId: z.number(),
      content: z.string(),
      files: z.array(messageFileInput).optional()
    })
  )
  .mutation(async ({ input, ctx }) => {
    const message = await db
      .select({
        userId: messages.userId,
        pluginId: messages.pluginId,
        channelId: messages.channelId,
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

    const sanitizedContent = sanitizeMessageHtml(input.content);
    const shouldUpdateFiles = input.files !== undefined;
    const settings = shouldUpdateFiles ? await getSettings() : undefined;
    const fileInputs = shouldUpdateFiles ? input.files! : undefined;
    const hasTemporaryFiles =
      fileInputs?.some((file) => file.type === 'temporary') ?? false;
    const currentFiles = shouldUpdateFiles
      ? await getFilesByMessageId(input.messageId)
      : [];

    if (hasTemporaryFiles) {
      invariant(settings!.storageUploadEnabled, {
        code: 'FORBIDDEN',
        message: 'File uploads are disabled on this server'
      });

      const isDmChannel = await isDirectMessageChannel(message.channelId);

      if (isDmChannel) {
        invariant(settings!.storageFileSharingInDirectMessages, {
          code: 'FORBIDDEN',
          message: 'File sharing in direct messages is disabled on this server'
        });
      }
    }

    const finalFileCount = shouldUpdateFiles
      ? (fileInputs?.length ?? 0)
      : currentFiles.length;

    invariant(!isEmptyMessage(sanitizedContent) || finalFileCount > 0, {
      code: 'BAD_REQUEST',
      message:
        'Your message only contained unsupported or removed content, so there was nothing to send.'
    });

    await db
      .update(messages)
      .set({
        content: sanitizedContent,
        updatedAt: Date.now(),
        editedAt: Date.now(),
        editedBy: ctx.user.id
      })
      .where(eq(messages.id, input.messageId));

    if (shouldUpdateFiles) {
      const currentFilesMap = new Map(
        currentFiles.map((file) => [file.id, file])
      );
      const keptExistingFileIds = new Set<number>();

      for (const fileInput of fileInputs!) {
        if (fileInput.type !== 'existing') {
          continue;
        }

        const existingFile = currentFilesMap.get(fileInput.id);

        invariant(existingFile, {
          code: 'BAD_REQUEST',
          message: 'File is not attached to this message'
        });

        if (keptExistingFileIds.has(fileInput.id)) {
          continue;
        }

        keptExistingFileIds.add(fileInput.id);

        const renamedOriginalName = getRenamedOriginalName(
          existingFile,
          fileInput.name
        );

        if (renamedOriginalName !== existingFile.originalName) {
          await db
            .update(files)
            .set({
              originalName: renamedOriginalName,
              updatedAt: Date.now()
            })
            .where(eq(files.id, existingFile.id));
        }
      }

      for (const fileInput of fileInputs!) {
        if (fileInput.type !== 'temporary') {
          continue;
        }

        const newFile = await fileManager.saveFile(
          fileInput.id,
          ctx.userId,
          FileSaveType.MESSAGE,
          fileInput.name
        );

        await db.insert(messageFiles).values({
          messageId: input.messageId,
          fileId: newFile.id,
          createdAt: Date.now()
        });
      }

      for (const existingFile of currentFiles) {
        if (!keptExistingFileIds.has(existingFile.id)) {
          await removeFile(existingFile.id);
        }
      }
    }

    publishMessage(input.messageId, message.channelId, 'update');
    enqueueProcessMetadata(sanitizedContent, input.messageId);

    eventBus.emit('message:updated', {
      messageId: input.messageId,
      channelId: message.channelId,
      userId: message.userId,
      pluginId: message.pluginId,
      content: sanitizedContent,
      textContent: getPlainTextFromHtml(sanitizedContent)
    });
  });

export { editMessageRoute };

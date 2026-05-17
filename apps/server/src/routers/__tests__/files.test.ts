import type { TFile, TTempFile } from '@mikotord/shared';
import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import { initTest, login, uploadFile } from '../../__tests__/helpers';
import { tdb } from '../../__tests__/setup';
import { files, messageFiles, messages, settings } from '../../db/schema';
import { PUBLIC_PATH } from '../../helpers/paths';
import { fileManager } from '../../utils/file-manager';

describe('files router', () => {
  let tempFile: TTempFile;
  let counter = 0;

  const uploadTemporaryFile = async (
    token: string,
    content: string,
    name = `office-${counter++}.docx`
  ) => {
    const response = await uploadFile(
      new File([content], name, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }),
      token
    );

    return (await response.json()) as TTempFile;
  };

  const getAttachedFile = async (messageId: number): Promise<TFile> => {
    const row = await tdb
      .select({
        file: files
      })
      .from(messageFiles)
      .innerJoin(files, eq(messageFiles.fileId, files.id))
      .where(eq(messageFiles.messageId, messageId))
      .get();

    expect(row?.file).toBeDefined();

    return row!.file;
  };

  beforeEach(async () => {
    const response = await login('testowner', 'password123');
    const data: any = await response.json();

    const res = await uploadFile(
      new File(['test'], `file-${counter++}.txt`, { type: 'text/plain' }),
      data.token
    );

    tempFile = (await res.json()) as TTempFile;
  });

  test('should check temporary file existence', async () => {
    expect(tempFile).toBeDefined();
    expect(tempFile.id).toBeDefined();

    const file = await fileManager.getTemporaryFile(tempFile.id);

    expect(file).toBeDefined();
    expect(file?.path).toBe(tempFile.path);
    expect(file?.originalName).toBe(tempFile.originalName);
    expect(file?.size).toBe(tempFile.size);

    const stat = await fs.stat(tempFile.path);

    expect(stat.size).toBe(tempFile.size);
  });

  test('should delete a temporary file', async () => {
    const { caller } = await initTest();

    expect(await fs.exists(tempFile.path)).toBe(true);

    await caller.files.deleteTemporary({
      fileId: tempFile.id
    });

    expect(await fs.exists(tempFile.path)).toBe(false);
  });

  test('should throw when deleting a non-existent temporary file', async () => {
    const { caller } = await initTest();

    await expect(
      caller.files.deleteTemporary({
        fileId: '<non-existent-file-id>' // non-existent file ID
      })
    ).rejects.toThrow('Temporary file not found');
  });

  test('should throw when deleting other users temporary file', async () => {
    const { caller } = await initTest(2);

    await expect(
      caller.files.deleteTemporary({
        fileId: tempFile.id
      })
    ).rejects.toThrow(
      'You do not have permission to delete this temporary file'
    );

    expect(await fs.exists(tempFile.path)).toBe(true);
  });

  test('should replace a message file with a temporary file', async () => {
    const { caller, mockedToken } = await initTest();
    const originalTemp = await uploadTemporaryFile(
      mockedToken,
      'original office content',
      'original.docx'
    );
    const messageId = await caller.messages.send({
      content: 'Message with office file',
      channelId: 1,
      files: [originalTemp.id]
    });
    const originalFile = await getAttachedFile(messageId);
    const originalPath = path.join(PUBLIC_PATH, originalFile.name);
    const replacementTemp = await uploadTemporaryFile(
      mockedToken,
      'updated office content',
      'updated.docx'
    );

    const replacedFile = await caller.files.replaceMessageFile({
      messageId,
      fileId: originalFile.id,
      temporaryFileId: replacementTemp.id,
      name: 'updated.docx'
    });

    expect(replacedFile.id).not.toBe(originalFile.id);
    expect(replacedFile.originalName).toBe('updated.docx');
    expect(await fs.exists(originalPath)).toBe(false);

    const attachedFile = await getAttachedFile(messageId);
    const updatedPath = path.join(PUBLIC_PATH, attachedFile.name);

    expect(attachedFile.id).toBe(replacedFile.id);
    expect(await fs.readFile(updatedPath, 'utf-8')).toBe(
      'updated office content'
    );

    const updatedMessage = await tdb
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .get();

    expect(updatedMessage?.editedBy).toBe(1);
    expect(typeof updatedMessage?.editedAt).toBe('number');
  });

  test('should reject replacing another users message file', async () => {
    const owner = await initTest();
    const originalTemp = await uploadTemporaryFile(
      owner.mockedToken,
      'original office content'
    );
    const messageId = await owner.caller.messages.send({
      content: 'Message with office file',
      channelId: 1,
      files: [originalTemp.id]
    });
    const originalFile = await getAttachedFile(messageId);
    const user = await initTest(2);
    const replacementTemp = await uploadTemporaryFile(
      user.mockedToken,
      'updated office content'
    );

    await expect(
      user.caller.files.replaceMessageFile({
        messageId,
        fileId: originalFile.id,
        temporaryFileId: replacementTemp.id
      })
    ).rejects.toThrow('You do not have permission to edit this message');
  });

  test('should reject replacing a file on a non-editable message', async () => {
    const { caller, mockedToken } = await initTest();
    const originalTemp = await uploadTemporaryFile(
      mockedToken,
      'original office content'
    );
    const messageId = await caller.messages.send({
      content: 'Message with office file',
      channelId: 1,
      files: [originalTemp.id]
    });
    const originalFile = await getAttachedFile(messageId);
    const replacementTemp = await uploadTemporaryFile(
      mockedToken,
      'updated office content'
    );

    await tdb
      .update(messages)
      .set({ editable: false })
      .where(eq(messages.id, messageId));

    await expect(
      caller.files.replaceMessageFile({
        messageId,
        fileId: originalFile.id,
        temporaryFileId: replacementTemp.id
      })
    ).rejects.toThrow('This message is not editable');
  });

  test('should reject replacing a file not attached to the message', async () => {
    const { caller, mockedToken } = await initTest();
    const originalTemp = await uploadTemporaryFile(
      mockedToken,
      'original office content'
    );
    const messageId = await caller.messages.send({
      content: 'Message with office file',
      channelId: 1,
      files: [originalTemp.id]
    });
    const detachedTemp = await uploadTemporaryFile(
      mockedToken,
      'detached office content'
    );
    const detachedFile = await fileManager.saveFile(detachedTemp.id, 1);
    const replacementTemp = await uploadTemporaryFile(
      mockedToken,
      'updated office content'
    );

    await expect(
      caller.files.replaceMessageFile({
        messageId,
        fileId: detachedFile.id,
        temporaryFileId: replacementTemp.id
      })
    ).rejects.toThrow('File is not attached to this message');
  });

  test('should return a signed file after replacing when signed URLs are enabled', async () => {
    const { caller, mockedToken } = await initTest();

    await tdb.update(settings).set({
      storageSignedUrlsEnabled: true,
      storageSignedUrlsTtlSeconds: 3600
    });

    const originalTemp = await uploadTemporaryFile(
      mockedToken,
      'original office content'
    );
    const messageId = await caller.messages.send({
      content: 'Message with office file',
      channelId: 1,
      files: [originalTemp.id]
    });
    const originalFile = await getAttachedFile(messageId);
    const replacementTemp = await uploadTemporaryFile(
      mockedToken,
      'updated office content'
    );

    const replacedFile = await caller.files.replaceMessageFile({
      messageId,
      fileId: originalFile.id,
      temporaryFileId: replacementTemp.id
    });

    expect(typeof replacedFile._accessToken).toBe('string');
    expect(typeof replacedFile._accessTokenExpiresAt).toBe('number');
  });
});

import { getPlainTextFromHtml, type TFile } from '@mikotord/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config';
import { db } from '../../db';
import { getChannelsForUser } from '../../db/queries/channels';
import { getDirectMessageChannelIdsForUser } from '../../db/queries/dms';
import { getSettings } from '../../db/queries/server';
import {
  channels,
  directMessages,
  files,
  messageFiles,
  messages,
  users
} from '../../db/schema';
import { attachFileToken } from '../../helpers/files-crypto';
import { invariant } from '../../utils/invariant';
import { protectedProcedure, rateLimitedProcedure } from '../../utils/trpc';

// this search is pretty basic and it CAN be optimized, however it might not be worth it
// some things things we can do:
// check https://sqlite.org/fts5.html for full text search capabilities, but it might be an overkill and add complexity to the codebase
// save an already pre-processed plain text version of the message content in the database to avoid having to do it in JS and speed up the search (this would require updating the existing messages and keeping it in sync for new messages, but it would make the search much faster and more accurate)
// for files the same applies, we could save a pre-processed version of the original name in lowercase to speed up the search and make it more accurate
// however, the quick test I did with close to 10k messages the request was taking around 4-8 ms, which is more than good enough

const SEARCH_QUERY_MIN_LENGTH = 2; // minimum length for search query to prevent too broad searches
const SEARCH_QUERY_MAX_LENGTH = 24; // maximum length for search query to prevent performance issues and potential abuse
const MESSAGE_FETCH_MULTIPLIER = 4; // multiplier to fetch more messages than requested to account for filtering after fetching from the database
const MAX_MESSAGE_FETCH_LIMIT = 100; // absolute maximum number of messages to fetch from the database before filtering, to prevent performance issues

const MESSAGES_LIMIT = 25;
const FILES_LIMIT = 25;

const escapeLikePattern = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const searchMessagesRoute = rateLimitedProcedure(protectedProcedure, {
  maxRequests: config.rateLimiters.search.maxRequests,
  windowMs: config.rateLimiters.search.windowMs,
  logLabel: 'search'
})
  .input(
    z.object({
      query: z
        .string()
        .trim()
        .toLowerCase()
        .min(SEARCH_QUERY_MIN_LENGTH)
        .max(SEARCH_QUERY_MAX_LENGTH)
    })
  )
  .query(async ({ ctx, input }) => {
    const settings = await getSettings();

    invariant(settings.enableSearch, 'Search is disabled on this server');

    const [accessibleChannels, participantDmChannelIds] = await Promise.all([
      getChannelsForUser(ctx.userId),
      getDirectMessageChannelIdsForUser(ctx.userId)
    ]);

    const participantDmChannelIdSet = new Set(participantDmChannelIds);
    const accessibleChannelIds = accessibleChannels
      .filter(
        (channel) => !channel.isDm || participantDmChannelIdSet.has(channel.id)
      )
      .map((channel) => channel.id);
    const accessibleDmChannelIds = accessibleChannelIds.filter((channelId) =>
      participantDmChannelIdSet.has(channelId)
    );

    if (accessibleChannelIds.length === 0) {
      return {
        messages: [],
        files: []
      };
    }

    const likePattern = `%${escapeLikePattern(input.query)}%`;
    const messageFetchLimit = Math.min(
      MESSAGES_LIMIT * MESSAGE_FETCH_MULTIPLIER,
      MAX_MESSAGE_FETCH_LIMIT
    );

    const dmChannelNames = new Map<number, string>();

    if (accessibleDmChannelIds.length > 0) {
      const dmRows = await db
        .select({
          channelId: directMessages.channelId,
          userOneId: directMessages.userOneId,
          userTwoId: directMessages.userTwoId
        })
        .from(directMessages)
        .where(inArray(directMessages.channelId, accessibleDmChannelIds));
      const otherUserIds = dmRows.map((row) =>
        row.userOneId === ctx.userId ? row.userTwoId : row.userOneId
      );
      const dmUsers =
        otherUserIds.length > 0
          ? await db
              .select({
                id: users.id,
                name: users.name
              })
              .from(users)
              .where(inArray(users.id, otherUserIds))
          : [];
      const userNameById = new Map(dmUsers.map((user) => [user.id, user.name]));

      for (const row of dmRows) {
        const otherUserId =
          row.userOneId === ctx.userId ? row.userTwoId : row.userOneId;

        dmChannelNames.set(
          row.channelId,
          userNameById.get(otherUserId) ?? 'Direct Message'
        );
      }
    }

    const getChannelDisplayName = (channel: {
      channelId: number;
      channelName: string;
      channelIsDm: boolean;
    }) =>
      channel.channelIsDm
        ? (dmChannelNames.get(channel.channelId) ?? channel.channelName)
        : channel.channelName;

    const [messageRows, fileRows] = await Promise.all([
      db
        .select({
          message: messages,
          channelId: channels.id,
          channelName: channels.name,
          channelIsDm: channels.isDm,
          channelPrivate: channels.private
        })
        .from(messages)
        .innerJoin(channels, eq(channels.id, messages.channelId))
        .where(
          and(
            inArray(messages.channelId, accessibleChannelIds),
            sql`lower(coalesce(${messages.content}, '')) LIKE ${likePattern} ESCAPE '\\'`
          )
        )
        .orderBy(desc(messages.createdAt))
        .limit(messageFetchLimit),
      db
        .select({
          file: files,
          messageId: messages.id,
          parentMessageId: messages.parentMessageId,
          channelId: messages.channelId,
          messageContent: messages.content,
          messageCreatedAt: messages.createdAt,
          channelName: channels.name,
          channelIsDm: channels.isDm,
          channelPrivate: channels.private
        })
        .from(messageFiles)
        .innerJoin(files, eq(files.id, messageFiles.fileId))
        .innerJoin(messages, eq(messages.id, messageFiles.messageId))
        .innerJoin(channels, eq(channels.id, messages.channelId))
        .where(
          and(
            inArray(messages.channelId, accessibleChannelIds),
            sql`lower(${files.originalName}) LIKE ${likePattern} ESCAPE '\\'`
          )
        )
        .orderBy(desc(messages.createdAt))
        .limit(FILES_LIMIT)
    ]);

    const matchedMessages = messageRows
      .map((row) => {
        const plainContent = getPlainTextFromHtml(
          row.message.content ?? ''
        ).trim();

        return {
          ...row,
          plainContent
        };
      })
      .filter((row) => {
        if (!row.plainContent) {
          return false;
        }

        return row.plainContent.toLowerCase().includes(input.query);
      })
      .slice(0, MESSAGES_LIMIT);

    const matchedMessageIds = matchedMessages.map((row) => row.message.id);

    const attachedFileRows =
      matchedMessageIds.length > 0
        ? await db
            .select({
              messageId: messageFiles.messageId,
              file: files
            })
            .from(messageFiles)
            .innerJoin(files, eq(files.id, messageFiles.fileId))
            .where(inArray(messageFiles.messageId, matchedMessageIds))
        : [];

    const filesByMessageId = new Map<number, TFile[]>();

    for (const row of attachedFileRows) {
      const list = filesByMessageId.get(row.messageId) ?? [];

      list.push({ ...row.file });
      filesByMessageId.set(row.messageId, list);
    }

    const matchedMessagesWithFiles = matchedMessages.map((row) => {
      const messageFiles = filesByMessageId.get(row.message.id) ?? [];

      const preparedFiles = messageFiles.map((file) =>
        attachFileToken(
          file,
          settings.storageSignedUrlsEnabled,
          settings.storageSignedUrlsTtlSeconds
        )
      );

      return {
        ...row.message,
        channelName: getChannelDisplayName(row),
        channelIsDm: row.channelIsDm,
        plainContent: row.plainContent,
        files: preparedFiles,
        reactions: []
      };
    });

    const matchedFiles = fileRows.map((row) => {
      const file = attachFileToken(
        row.file,
        settings.storageSignedUrlsEnabled,
        settings.storageSignedUrlsTtlSeconds
      );

      return {
        file,
        messageId: row.messageId,
        parentMessageId: row.parentMessageId,
        channelId: row.channelId,
        messageContent: row.messageContent,
        messageCreatedAt: row.messageCreatedAt,
        channelName: getChannelDisplayName(row),
        channelIsDm: row.channelIsDm
      };
    });

    return {
      messages: matchedMessagesWithFiles,
      files: matchedFiles
    };
  });

export { searchMessagesRoute };

import { isEmojiOnlyMessage, type TJoinedMessage } from '@mikotord/shared';
import parse, { type DOMNode } from 'html-react-parser';
import type { ReactNode } from 'react';
import { serializer } from './serializer';

const MAX_CACHE_SIZE = 500;

const parsedMessageCache = new Map<string, ReactNode>();
const emojiOnlyCache = new Map<string, boolean>();
const markdownSourceCache = new Map<string, string | null>();

const trimCache = (cache: Map<string, unknown>) => {
  if (cache.size < MAX_CACHE_SIZE) {
    return;
  }

  const oldestKey = cache.keys().next().value;

  if (oldestKey) {
    cache.delete(oldestKey);
  }
};

const getMessageContentCacheKey = (message: TJoinedMessage) =>
  `${message.id}:${message.editedAt ?? 0}:${message.content ?? ''}`;

const getClaudeCodeMarkdownSource = (content: string | null | undefined) => {
  const markdownMatch = /^<pre data-claude-code-markdown="true">([\s\S]*)<\/pre>$/.exec(
    content ?? ''
  );

  if (!markdownMatch) {
    return undefined;
  }

  const textarea = document.createElement('textarea');

  textarea.innerHTML = markdownMatch[1] ?? '';

  return textarea.value;
};

const getMarkdownFromHtmlNode = (node: Node, parentTag?: string): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const children = () =>
    Array.from(element.childNodes)
      .map((child) => getMarkdownFromHtmlNode(child, tag))
      .join('');

  if (tag === 'br') {
    return '\n';
  }

  if (tag === 'pre') {
    return `\n${element.textContent ?? ''}\n\n`;
  }

  if (tag === 'code' && parentTag !== 'pre') {
    return `\`${children().trim()}\``;
  }

  if (tag === 'strong' || tag === 'b') {
    return `**${children().trim()}**`;
  }

  if (tag === 'em' || tag === 'i') {
    return `*${children().trim()}*`;
  }

  if (tag === 'a') {
    const href = element.getAttribute('href');
    const label = children().trim();

    if (!href || href === label) {
      return label;
    }

    return `[${label}](${href})`;
  }

  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1));

    return `${'#'.repeat(level)} ${children().trim()}\n\n`;
  }

  if (tag === 'li') {
    return `- ${children().trim()}\n`;
  }

  if (tag === 'ul' || tag === 'ol') {
    return `${children().trimEnd()}\n\n`;
  }

  if (
    tag === 'p' ||
    tag === 'div' ||
    tag === 'blockquote' ||
    tag === 'section'
  ) {
    const text = children().trim();

    return text ? `${text}\n\n` : '\n';
  }

  return children();
};

const getMarkdownTextFromHtml = (content: string) => {
  const container = document.createElement('div');

  container.innerHTML = content;

  return getMarkdownFromHtmlNode(container)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const getFencedMarkdownSource = (text: string) => {
  const markdownMatch = /^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n?```$/i.exec(
    text.trim()
  );

  return markdownMatch?.[1]?.trim();
};

const isMarkdownLike = (text: string) => {
  const source = text.trim();

  if (!source) {
    return false;
  }

  let score = 0;

  if (/^#{1,6}\s+\S/m.test(source)) score += 3;
  if (/^\s{0,3}(?:[-*+]\s+|\d+\.\s+)/m.test(source)) score += 2;
  if (/^\s{0,3}>\s+\S/m.test(source)) score += 2;
  if (/```[\s\S]*```/.test(source)) score += 3;
  if (/\*\*[^*\n]+?\*\*/.test(source)) score += 1;
  if (/`[^`\n]+?`/.test(source)) score += 1;
  if (/\[[^\]\n]+\]\([^)]+\)/.test(source)) score += 2;
  if (/^\|.+\|\s*$/m.test(source)) score += 2;

  return score >= 2;
};

const getMessageMarkdownSource = (content: string | null | undefined) => {
  const cacheKey = content ?? '';

  if (markdownSourceCache.has(cacheKey)) {
    return markdownSourceCache.get(cacheKey) ?? undefined;
  }

  trimCache(markdownSourceCache);

  const claudeCodeMarkdownSource = getClaudeCodeMarkdownSource(content);

  if (claudeCodeMarkdownSource !== undefined) {
    markdownSourceCache.set(cacheKey, claudeCodeMarkdownSource);
    return claudeCodeMarkdownSource;
  }

  const text = getMarkdownTextFromHtml(content ?? '');
  const fencedMarkdownSource = getFencedMarkdownSource(text);
  const markdownSource =
    fencedMarkdownSource !== undefined
      ? fencedMarkdownSource
      : isMarkdownLike(text)
        ? text
        : undefined;

  markdownSourceCache.set(cacheKey, markdownSource ?? null);

  return markdownSource;
};

const getParsedMessageHtml = (message: TJoinedMessage) => {
  const cacheKey = getMessageContentCacheKey(message);

  if (parsedMessageCache.has(cacheKey)) {
    return parsedMessageCache.get(cacheKey);
  }

  trimCache(parsedMessageCache);

  const parsed = parse(message.content ?? '', {
    replace: (domNode: DOMNode) => serializer(domNode, message.id)
  });

  parsedMessageCache.set(cacheKey, parsed);

  return parsed;
};

const getIsEmojiOnly = (message: TJoinedMessage) => {
  const cacheKey = getMessageContentCacheKey(message);

  if (emojiOnlyCache.has(cacheKey)) {
    return emojiOnlyCache.get(cacheKey)!;
  }

  trimCache(emojiOnlyCache);

  const emojiOnly = isEmojiOnlyMessage(message.content);

  emojiOnlyCache.set(cacheKey, emojiOnly);

  return emojiOnly;
};

export {
  getClaudeCodeMarkdownSource,
  getIsEmojiOnly,
  getMessageMarkdownSource,
  getParsedMessageHtml
};

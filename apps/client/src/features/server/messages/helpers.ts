const messageHighlightTimeouts = new WeakMap<Element, NodeJS.Timeout>();
const MESSAGE_HIGHLIGHT_CLASS = 'bg-white/35';

export const getMessagesContainer = (channelId?: number) =>
  document.querySelector(
    channelId
      ? `[data-messages-container][data-channel-id="${channelId}"]`
      : '[data-messages-container]'
  );

export const findMessageElement = (messageId: number, channelId?: number) =>
  channelId
    ? (getMessagesContainer(channelId)?.querySelector(
        `[data-message-id="${messageId}"]`
      ) ?? null)
    : document.querySelector(`[data-message-id="${messageId}"]`);

export const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export const highlightMessageElement = async (
  element: Element,
  highlightTime: number
) => {
  // yield twice to ensure the element is rendered and any pending layout calculations are done before we try to scroll to it and apply the highlight styles
  await nextFrame();
  await nextFrame();

  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.classList.add(MESSAGE_HIGHLIGHT_CLASS);

  if (messageHighlightTimeouts.has(element)) {
    clearTimeout(messageHighlightTimeouts.get(element));
  }

  const timeoutId = setTimeout(() => {
    element.classList.remove(MESSAGE_HIGHLIGHT_CLASS);

    messageHighlightTimeouts.delete(element);
  }, highlightTime);

  messageHighlightTimeouts.set(element, timeoutId);
};

export const waitForMessageElement = (
  messageId: number,
  channelId?: number,
  timeoutMs = 3000
): Promise<Element | null> =>
  new Promise((resolve) => {
    const existing = findMessageElement(messageId, channelId);

    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const element = findMessageElement(messageId, channelId);

      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });

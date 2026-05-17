export const MAX_QUICK_EMOJIS = 4;

const ACTION_ITEM_WIDTH_PX = 24;
const ACTION_GAP_PX = 4;
const ACTION_PADDING_X_PX = 16;
const ACTION_BORDER_X_PX = 2;
const ACTION_REACTION_DIVIDER_AND_PADDING_PX = 5;
const ACTION_OFFSET_X_PX = 4;
const MESSAGE_BUBBLE_MARGIN_LEFT_PX = 4;

type TMessageActionsWidthOptions = {
  canReply: boolean;
  canThread: boolean;
  canManage: boolean;
  canReact: boolean;
  quickEmojiCount: number;
};

const getMessageActionsReservedWidth = ({
  canReply,
  canThread,
  canManage,
  canReact,
  quickEmojiCount
}: TMessageActionsWidthOptions) => {
  const visibleActionButtonCount =
    Number(canReply) + Number(canThread) + (canManage ? 2 : 0);
  const actionButtonCount = Math.max(4, visibleActionButtonCount);
  const reactionItemCount = canReact ? quickEmojiCount + 1 : 0;
  const topLevelItemCount = actionButtonCount + Number(canReact);
  const topLevelGaps = Math.max(0, topLevelItemCount - 1) * ACTION_GAP_PX;
  const reactionGaps = Math.max(0, reactionItemCount - 1) * ACTION_GAP_PX;
  const reactionWidth = canReact
    ? ACTION_REACTION_DIVIDER_AND_PADDING_PX +
      reactionItemCount * ACTION_ITEM_WIDTH_PX +
      reactionGaps
    : 0;

  return (
    ACTION_PADDING_X_PX +
    ACTION_BORDER_X_PX +
    actionButtonCount * ACTION_ITEM_WIDTH_PX +
    reactionWidth +
    topLevelGaps +
    ACTION_OFFSET_X_PX +
    MESSAGE_BUBBLE_MARGIN_LEFT_PX
  );
};

export { getMessageActionsReservedWidth };

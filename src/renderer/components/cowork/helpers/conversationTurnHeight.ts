import type { ConversationTurn } from './messageGrouping';

const DEFAULT_TURN_HEIGHT_PX = 300;
const TURN_BASE_HEIGHT_PX = 72;
const TEXT_LINE_HEIGHT_PX = 22;
const APPROXIMATE_UNITS_PER_LINE = 72;
const MAX_ESTIMATED_TEXT_LINES = 800;
const TOOL_GROUP_HEIGHT_PX = 84;
const MIN_TURN_HEIGHT_PX = 180;
const MAX_TURN_HEIGHT_PX = 18_000;

const estimateLineUnits = (line: string): number => {
  let units = 0;
  for (const character of line) {
    units += character.codePointAt(0)! > 0xff ? 2 : 1;
  }
  return units;
};

const estimateTextLines = (content: string): number => {
  if (!content) return 0;
  let lines = 0;
  for (const line of content.split('\n')) {
    lines += Math.max(1, Math.ceil(estimateLineUnits(line) / APPROXIMATE_UNITS_PER_LINE));
    if (lines >= MAX_ESTIMATED_TEXT_LINES) return MAX_ESTIMATED_TEXT_LINES;
  }
  return lines;
};

const estimateTextHeight = (content: string): number =>
  estimateTextLines(content) * TEXT_LINE_HEIGHT_PX + (content ? 24 : 0);

export const estimateConversationTurnHeight = (turn: ConversationTurn): number => {
  let height = TURN_BASE_HEIGHT_PX;
  let hasContent = false;
  if (turn.userMessage) {
    height += estimateTextHeight(turn.userMessage.content);
    hasContent = true;
  }

  for (const item of turn.assistantItems) {
    hasContent = true;
    height +=
      item.type === 'tool_group' ? TOOL_GROUP_HEIGHT_PX : estimateTextHeight(item.message.content);
  }

  if (!hasContent) return DEFAULT_TURN_HEIGHT_PX;
  return Math.min(MAX_TURN_HEIGHT_PX, Math.max(MIN_TURN_HEIGHT_PX, height));
};

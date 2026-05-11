import { MentionResult } from './mention-extractor';

export type MentionPositionLabel =
  | 'First mentioned'
  | 'Top 3'
  | 'In list'
  | 'Passing reference'
  | 'Not mentioned';

/**
 * Classifies the brand's position in the response based on mention data.
 */
export function classifyPosition(
  brandName: string,
  mentions: MentionResult[],
): { label: MentionPositionLabel; position: number | null } {
  const brandMentions = mentions.filter(
    (m) => m.type === 'brand' && m.name.toLowerCase() === brandName.toLowerCase(),
  );

  if (brandMentions.length === 0) {
    return { label: 'Not mentioned', position: null };
  }

  // Use the earliest (lowest position value) mention
  const earliest = brandMentions.reduce((a, b) => (a.position < b.position ? a : b));
  const pos = earliest.position;

  // Check if the segment is a list item (starts with -, *, number, or bullet)
  const isListItem = /^[\s]*[-*•\d]+[.)]\s/m.test(earliest.segment);

  if (pos === 1) return { label: 'First mentioned', position: pos };
  if (pos <= 3) return { label: 'Top 3', position: pos };
  if (isListItem) return { label: 'In list', position: pos };
  return { label: 'Passing reference', position: pos };
}

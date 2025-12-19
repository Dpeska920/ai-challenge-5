/**
 * Converts Markdown to Telegram-compatible HTML
 * Supports: bold, italic, strikethrough, code, code blocks, links
 */

// Escape HTML special characters
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function markdownToTelegramHtml(markdown: string): string {
  let result = markdown;

  // Use unique markers that won't be affected by escaping or markdown processing
  // No underscores (italic), asterisks (bold), tildes (strikethrough), or HTML special chars
  const CODE_BLOCK_MARKER = '\u200BCBLK';
  const CODE_BLOCK_END = 'KCBL\u200B';
  const INLINE_CODE_MARKER = '\u200BICOD';
  const INLINE_CODE_END = 'DOCI\u200B';

  // First, extract and preserve code blocks to avoid processing their content
  const codeBlocks: string[] = [];
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trim())}</pre>`);
    return `${CODE_BLOCK_MARKER}${index}${CODE_BLOCK_END}`;
  });

  // Extract and preserve inline code
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `${INLINE_CODE_MARKER}${index}${INLINE_CODE_END}`;
  });

  // Now escape HTML in the remaining text
  result = escapeHtml(result);

  // Links: [text](url) -> <a href="url">text</a>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Bold: **text** or __text__ -> <b>text</b>
  result = result.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  result = result.replace(/__([^_]+)__/g, '<b>$1</b>');

  // Italic: *text* or _text_ -> <i>text</i>
  // Be careful not to match already processed bold or list markers
  result = result.replace(/(?<![*_])\*([^*\n]+)\*(?![*])/g, '<i>$1</i>');
  result = result.replace(/(?<![*_])_([^_\n]+)_(?![_])/g, '<i>$1</i>');

  // Strikethrough: ~~text~~ -> <s>text</s>
  result = result.replace(/~~([^~]+)~~/g, '<s>$1</s>');

  // Restore code blocks and inline code
  codeBlocks.forEach((block, index) => {
    result = result.replace(`${CODE_BLOCK_MARKER}${index}${CODE_BLOCK_END}`, block);
  });

  inlineCodes.forEach((code, index) => {
    result = result.replace(`${INLINE_CODE_MARKER}${index}${INLINE_CODE_END}`, code);
  });

  return result;
}

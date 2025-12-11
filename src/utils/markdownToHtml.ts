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

  // First, extract and preserve code blocks to avoid processing their content
  const codeBlocks: string[] = [];
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    const index = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trim())}</pre>`);
    return `\x00CODE_BLOCK_${index}\x00`;
  });

  // Extract and preserve inline code
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINE_CODE_${index}\x00`;
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
    result = result.replace(`\x00CODE_BLOCK_${index}\x00`, block);
  });

  inlineCodes.forEach((code, index) => {
    result = result.replace(`\x00INLINE_CODE_${index}\x00`, code);
  });

  return result;
}

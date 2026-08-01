/** Counts whitespace-separated tokens, ignoring pure-markup tokens like "#". */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

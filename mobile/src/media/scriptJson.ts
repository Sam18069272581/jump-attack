/**
 * A value as JSON for a page's inline <script>. Written as is, a string holding `</script>` (a clip's name keeps the
 * extension of the file picked) would end the script there and let the rest run as markup. So every `<` is written
 * as the six-character JSON escape of U+003C, and U+2028 and U+2029, which older engines don't take inside a string
 * literal, are escaped the same way.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

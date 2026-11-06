declare module 'hypher' {
  export default class Hypher { constructor(patterns: unknown); hyphenate(word: string): string[]; }
}
declare module 'hyphenation.ru' { const patterns: unknown; export default patterns; }

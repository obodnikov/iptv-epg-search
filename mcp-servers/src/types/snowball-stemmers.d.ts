/**
 * Type declarations for the untyped npm packages this project uses.
 *
 * `snowball-stemmers` is a UMD/CommonJS bundle without types. It is the
 * exact same file the web app ships in public/vendor/snowball-stemmers.js
 * (same sha256), so the stemming behaviour is identical.
 */

declare module 'snowball-stemmers' {
  export interface SnowballStemmer {
    /** Stem one word. */
    stem(word: string): string;
  }

  export function newStemmer(language: string): SnowballStemmer;

  export function algorithms(): string[];

  const snowballFactory: {
    newStemmer: typeof newStemmer;
    algorithms: typeof algorithms;
  };

  export default snowballFactory;
}

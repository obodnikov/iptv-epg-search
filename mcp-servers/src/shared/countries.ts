/**
 * countries.ts - country names in any language to ISO 3166-1 alpha-2.
 *
 * The provider writes the country in the language of the film and allows
 * several countries in one attribute ("Canada, United States of America").
 * `country-table.ts` holds the data; this module holds the lookup.
 *
 * Unknown names keep a null code and are still found by text search
 * (design: cinema-server.md §3.4). Extra names can be added at runtime with
 * the `countryAliases` setting.
 */

import { COUNTRY_CODES, COUNTRY_NAMES } from './country-table.ts';

export { COUNTRY_CODES, COUNTRY_NAMES };

/**
 * Normalize a country name for lookup: lower case, ё to е, collapsed spaces.
 */
export function normalizeCountryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map a country name to its ISO 3166-1 alpha-2 code.
 *
 * @param name Country name in any language.
 * @param aliases Extra name to code pairs from the `countryAliases` setting.
 * @returns The code, or null when the name is not known.
 */
export function countryCode(name: string, aliases: Record<string, string> = {}): string | null {
  const key = normalizeCountryName(name);
  if (!key) return null;

  const alias = aliasCode(key, aliases);
  if (alias) return alias;

  return COUNTRY_CODES[key] ?? null;
}

/**
 * The code of an alias, found by the normalised name.
 * The keys of the aliases are normalised as well, so that an alias written
 * "United States" matches the name "UNITED STATES".
 */
function aliasCode(key: string, aliases: Record<string, string>): string | null {
  for (const [aliasKey, aliasValue] of Object.entries(aliases)) {
    if (normalizeCountryName(aliasKey) !== key) continue;
    if (typeof aliasValue !== 'string') continue;
    const value = normalizeCountryName(aliasValue);
    if (!value) continue;
    if (/^[a-z]{2}$/.test(value)) return value.toUpperCase();
    return COUNTRY_CODES[value] ?? null;
  }
  return null;
}

/**
 * Split the raw `country` attribute into its single country names.
 * The provider writes several countries separated by commas.
 */
export function splitCountryList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Map every country of a raw `country` attribute to its ISO code.
 * Unknown names are skipped.
 */
export function countryCodesOf(raw: string, aliases: Record<string, string> = {}): string[] {
  const codes: string[] = [];
  for (const name of splitCountryList(raw)) {
    const code = countryCode(name, aliases);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/**
 * English name of an ISO code, falling back to the code itself.
 */
export function countryName(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] ?? code.toUpperCase();
}

/**
 * check-real-data.ts - run the cinema parser over a real catalogue file and
 * print the counts.
 *
 * The numbers are compared with the table in
 * mcp-servers/docs/design/cinema-server.md §2.2. They are not asserted in
 * CI: the file is the user's own provider data and is never in the
 * repository.
 *
 * Usage: npm run check-real-data [-- <path to index.m3u>]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildCatalog } from '../src/cinema/catalog.ts';
import { parseCinemaCatalog } from '../src/cinema/parser.ts';
import { countryCode, splitCountryList } from '../src/shared/countries.ts';

const DEFAULT_PATH = resolve(process.cwd(), '..', 'tmp', 'index.m3u');

function main(): void {
  const argument = process.argv[2];
  const path = argument ? resolve(argument) : DEFAULT_PATH;

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`file: ${path}`);
  console.log(`bytes: ${text.length}`);
  console.log('');

  const started = Date.now();
  const parsed = parseCinemaCatalog(text);
  const { titles, stats } = buildCatalog(parsed.entries);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log('--- counts (compare with cinema-server.md §2.2) ---');
  console.log(`entries read:            ${parsed.entries.length + parsed.rejected}`);
  console.log(`  rejected (bad URL):    ${parsed.rejected}`);
  console.log(`  without a stream line: ${parsed.incomplete}`);
  console.log(`film entries:            ${stats.filmEntries}   (expected 6303, minus the rejected ones)`);
  console.log(`film titles:             ${stats.films}   (expected about 5700)`);
  console.log(`series:                  ${stats.series}   (expected 1553)`);
  console.log(`unique episodes:         ${stats.episodes}   (expected 60785 entries)`);
  console.log(`titles in total:         ${titles.length}   (expected about 7300)`);
  console.log(`quality variants:        ${stats.variants}`);
  console.log(`adult titles:            ${stats.adultTitles}`);
  console.log(`titles tagged Новинки:   ${stats.newTagTitles}`);
  console.log(`parse time:              ${elapsed}s`);

  // --- the countries -------------------------------------------------------
  const countryNames = new Map<string, number>();
  const unknownCountries = new Map<string, number>();
  for (const entry of parsed.entries) {
    for (const name of splitCountryList(entry.country)) {
      countryNames.set(name, (countryNames.get(name) ?? 0) + 1);
      if (!countryCode(name)) {
        unknownCountries.set(name, (unknownCountries.get(name) ?? 0) + 1);
      }
    }
  }
  console.log('');
  console.log('--- countries ---');
  console.log(`distinct names:          ${countryNames.size}   (expected 143)`);
  console.log(`names without a code:    ${unknownCountries.size}`);
  for (const [name, count] of [...unknownCountries].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(7)}  ${name}`);
  }

  // --- the open points -----------------------------------------------------
  console.log('');
  console.log('--- open points ---');

  const zeroRating = parsed.entries.filter((entry) => entry.rating === 0);
  console.log(`rating = 0:              ${zeroRating.length}`);
  for (const entry of zeroRating.slice(0, 5)) {
    console.log(`  ${entry.title} (${entry.year ?? '?'}) category=${entry.category}`);
  }

  const adultGenre = parsed.entries.filter((entry) => entry.genres.includes('Взрослые'));
  const adultGenreCategories = new Map<string, number>();
  const adultGenreCensored = new Map<string, number>();
  for (const entry of adultGenre) {
    adultGenreCategories.set(entry.category, (adultGenreCategories.get(entry.category) ?? 0) + 1);
    adultGenreCensored.set(String(entry.censored), (adultGenreCensored.get(String(entry.censored)) ?? 0) + 1);
  }
  console.log(`genre "Взрослые":         ${adultGenre.length}`);
  console.log(`  categories:            ${JSON.stringify(Object.fromEntries(adultGenreCategories))}`);
  console.log(`  censored values:       ${JSON.stringify(Object.fromEntries(adultGenreCensored))}`);

  const censored = parsed.entries.filter((entry) => entry.censored);
  const censoredCategories = new Map<string, number>();
  for (const entry of censored) {
    censoredCategories.set(entry.category, (censoredCategories.get(entry.category) ?? 0) + 1);
  }
  console.log(`censored = 1:            ${censored.length}`);
  console.log(`  categories:            ${JSON.stringify(Object.fromEntries(censoredCategories))}`);

  // --- the durations --------------------------------------------------------
  const filmDurations = parsed.entries
    .filter((entry) => entry.type === 'film' && entry.durationMin !== null)
    .map((entry) => entry.durationMin ?? 0)
    .sort((a, b) => a - b);
  const episodeDurations = parsed.entries
    .filter((entry) => entry.type === 'episode' && entry.durationMin !== null)
    .map((entry) => entry.durationMin ?? 0)
    .sort((a, b) => a - b);
  console.log('');
  console.log('--- durations ---');
  if (filmDurations.length > 0) {
    console.log(
      `films (minutes):         p10 ${filmDurations[Math.floor(filmDurations.length * 0.1)]} p50 ${
        filmDurations[Math.floor(filmDurations.length * 0.5)]
      } p90 ${filmDurations[Math.floor(filmDurations.length * 0.9)]}`,
    );
  } else {
    console.log('films (minutes):         n/a');
  }
  if (episodeDurations.length > 0) {
    console.log(
      `episodes (minutes):      min ${episodeDurations[0]} max ${episodeDurations[episodeDurations.length - 1]}`,
    );
  } else {
    console.log('episodes (minutes):      n/a');
  }

  // --- the quality variants -------------------------------------------------
  const duplicates = new Map<string, number>();
  const qualities = new Map<string, number>();
  for (const title of titles) {
    if (title.type !== 'film') continue;
    if (title.variants.length > 1) {
      duplicates.set(title.titleNorm, title.variants.length);
    }
    for (const variant of title.variants) {
      qualities.set(variant.quality, (qualities.get(variant.quality) ?? 0) + 1);
    }
  }
  console.log('');
  console.log('--- quality variants ---');
  console.log(`films with several variants: ${duplicates.size}`);
  for (const [name, count] of [...qualities].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(7)}  ${name}`);
  }

  // --- the series names -----------------------------------------------------
  console.log('');
  console.log('--- series names ---');
  console.log(`names with more than one director: ${stats.seriesCollisions.length}`);
  for (const collision of stats.seriesCollisions.slice(0, 10)) {
    console.log(`  ${collision.title}: ${collision.directors.join(' | ')}`);
  }

  // --- the categories -------------------------------------------------------
  const categories = new Map<string, number>();
  for (const entry of parsed.entries) {
    categories.set(entry.category, (categories.get(entry.category) ?? 0) + 1);
  }
  console.log('');
  console.log('--- categories ---');
  for (const [name, count] of [...categories].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(7)}  ${name}`);
  }

  // --- the genres -----------------------------------------------------------
  const genres = new Map<string, number>();
  for (const entry of parsed.entries) {
    for (const genre of entry.genres) {
      genres.set(genre, (genres.get(genre) ?? 0) + 1);
    }
    for (const tag of entry.tags) {
      genres.set(`[tag] ${tag}`, (genres.get(`[tag] ${tag}`) ?? 0) + 1);
    }
  }
  console.log('');
  console.log('--- genres and provider tags ---');
  for (const [name, count] of [...genres].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(7)}  ${name}`);
  }
}

main();

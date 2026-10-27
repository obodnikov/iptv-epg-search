/**
 * render.ts - the compact text of the answers.
 *
 * The model reads the text first: one line per title, with the fields that
 * matter and nothing else. The structure behind it holds the same data.
 *
 * The play links are not in the text of a list: only the detail tools show
 * them (design: iptv-mcp-servers.md §5.4).
 */

import type { ListItem } from './search.ts';
import type { EpisodeItem, TitleDetails } from './details.ts';
import type { Facets } from './facets.ts';

/**
 * One title of a list, as one line.
 *
 * The id is on the line: the model reads the text and calls `get_title` or
 * `list_episodes` with it.
 */
export function renderListItem(item: ListItem): string {
  const parts: string[] = [];

  const kind = item.type === 'series' ? 'сериал' : 'фильм';
  const year = item.year === null ? '' : ` (${item.year})`;
  parts.push(`[${item.title_id}] ${item.title}${year} — ${kind}`);

  if (item.rating !== null) parts.push(`рейтинг ${item.rating}`);
  if (item.genres.length > 0) parts.push(item.genres.join(', '));
  if (item.countries.length > 0) parts.push(item.countries.join(', '));
  if (item.director) parts.push(`реж. ${item.director}`);
  if (item.duration_min !== null) parts.push(`${item.duration_min} мин`);
  if (item.type === 'series' && item.seasons !== null) {
    parts.push(`${item.seasons} сез. / ${item.episodes ?? 0} серий`);
  }
  if (item.added) parts.push(`добавлен ${item.added}`);

  const line = parts.join(' · ');

  // The excerpt of the description is on its own line, so that the fields
  // above stay readable.
  return item.snippet ? `${line}\n    ${item.snippet}` : line;
}

/**
 * The text of a list of titles.
 *
 * The engine is always the words; the text says how the result was found.
 */
export function renderList(items: ListItem[], total: number, usedWords: boolean): string {
  if (items.length === 0) return 'Nothing found.';

  const how = usedWords ? 'word search' : 'filters only';
  const head = `${total} title(s) found (${how}). Showing ${items.length}:`;
  return [head, ...items.map(renderListItem)].join('\n');
}

/**
 * One episode, as one line.
 */
export function renderEpisode(item: EpisodeItem): string {
  const parts: string[] = [`S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`];
  if (item.name) parts.push(item.name);
  if (item.duration_min !== null) parts.push(`${item.duration_min} мин`);
  parts.push(item.play_url);
  return parts.join(' · ');
}

/**
 * The text of a page of episodes.
 */
export function renderEpisodes(
  season: number,
  total: number,
  items: EpisodeItem[],
  droppedLinks = 0,
): string {
  const head = `Season ${season}: ${total} episode(s), showing ${items.length}:`;
  const lines = [head, ...items.map(renderEpisode)];

  if (items.length === 0) {
    lines.push('The season has no episode on this page.');
  }
  if (droppedLinks > 0) {
    lines.push(
      `${droppedLinks} episode link(s) were dropped: they were not http(s) URLs.`,
    );
  }

  return lines.join('\n');
}

/**
 * The text of the details of a title.
 */
export function renderDetails(details: TitleDetails): string {
  const lines: string[] = [];
  const year = details.year === null ? '' : ` (${details.year})`;
  lines.push(
    `[${details.title_id}] ${details.title}${year} — ${details.type === 'series' ? 'сериал' : 'фильм'}`,
  );
  if (details.rating !== null) lines.push(`Рейтинг провайдера: ${details.rating}`);
  if (details.genres.length > 0) lines.push(`Жанры: ${details.genres.join(', ')}`);
  if (details.countries.length > 0) {
    lines.push(
      `Страна: ${details.countries
        .map((country) => (country.code ? `${country.raw} (${country.code})` : country.raw))
        .join(', ')}`,
    );
  }
  if (details.director) lines.push(`Режиссёр: ${details.director}`);
  if (details.category) lines.push(`Категория: ${details.category}`);
  if (details.duration_min !== null) lines.push(`Длительность: ${details.duration_min} мин`);
  if (details.added) lines.push(`Добавлен: ${details.added}`);
  if (details.is_new_tag) lines.push('Провайдер отметил как новинку');
  if (details.removed) lines.push('Это название больше не в каталоге провайдера');
  if (details.description) lines.push('', details.description);

  if (details.variants.length > 0) {
    lines.push('', 'Ссылки на просмотр:');
    for (const variant of details.variants) {
      const length = variant.duration_min === null ? '' : ` (${variant.duration_min} мин)`;
      lines.push(`  ${variant.quality}${length}: ${variant.play_url}`);
    }
  } else if (details.type === 'film') {
    lines.push('', 'У этого фильма нет ссылки на просмотр.');
  }

  if (details.dropped_links > 0) {
    lines.push(
      `${details.dropped_links} link(s) were dropped: they were not http(s) URLs.`,
    );
  }

  if (details.seasons.length > 0) {
    const seasons = details.seasons
      .map((season) => `${season.season}: ${season.episodes}`)
      .join(', ');
    lines.push('', `Сезоны (номер: серий): ${seasons}`);
    lines.push('Ссылки на эпизоды: list_episodes');
  }

  return lines.join('\n');
}

/**
 * The text of the facets of the catalogue.
 */
export function renderFacets(facets: Facets): string {
  const lines: string[] = [];
  lines.push(
    `В каталоге ${facets.totals.titles} названий: ${facets.totals.films} фильмов и ${facets.totals.series} сериалов.`,
  );
  if (facets.categories.length > 0) {
    lines.push('', 'Категории:');
    for (const category of facets.categories) {
      lines.push(`  ${category.name} — ${category.count}`);
    }
  }
  if (facets.genres.length > 0) {
    lines.push('', 'Жанры:');
    for (const genre of facets.genres) {
      lines.push(`  ${genre.name} — ${genre.count}`);
    }
  }
  if (facets.countries.length > 0) {
    lines.push('', 'Страны:');
    for (const country of facets.countries) {
      const code = country.code ? `${country.code} ` : '';
      lines.push(`  ${code}${country.name} — ${country.count}`);
    }
  }
  lines.push(
    '',
    `Годы: ${facets.year_from ?? '—'} … ${facets.year_to ?? '—'}; рейтинг: ${
      facets.rating_from ?? '—'
    } … ${facets.rating_to ?? '—'}`,
  );
  if (facets.newest_added) lines.push(`Последнее добавление: ${facets.newest_added}`);
  lines.push(`Отмечено как новинки: ${facets.new_tag_count}`);

  return lines.join('\n');
}

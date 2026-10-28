/**
 * checks.ts - the ten checks of the design (design: cinema-server.md §10).
 *
 * Every check asks the server the question of §10 with the tool call the
 * design prescribes, and says whether the answer is the one the design
 * expects. The checks do not judge the model: they check the server, so
 * that the checks in Pilot are about the model.
 */

import {
  adultTitleIds,
  emptySettingsFolder,
  itemsOf,
  label,
  removeFolder,
  seriesWithThreeSeasons,
  startServer,
  structured,
  textOf,
  type Check,
} from './support.ts';

export const CHECKS: Check[] = [
  {
    id: 1,
    question: '«Найди французские драмы с рейтингом выше 7»',
    tool: 'search_titles(countries=["FR"], genres=["Драма"], min_rating=7)',
    async run(server) {
      const result = await server.call('search_titles', {
        countries: ['FR'],
        genres: ['Драма'],
        min_rating: 7,
      });
      if (result.isError) return { ok: false, note: `the answer is an error: ${textOf(result)}` };

      const items = itemsOf(result);
      const total = structured(result)['total'];
      if (items.length === 0) {
        return {
          ok: false,
          soft: true,
          note: `no title was found (total ${total}) - the catalogue may be empty`,
        };
      }

      const wrong = items.filter(
        (item) =>
          (item.rating ?? -1) < 7 ||
          !item.genres.includes('Драма') ||
          !item.countries.includes('FR'),
      );
      if (wrong.length > 0) {
        return {
          ok: false,
          note: `${wrong.length} of ${items.length} titles do not match the filters: ${wrong
            .slice(0, 3)
            .map(label)
            .join(', ')}`,
        };
      }

      return {
        ok: true,
        note: `${items.length} of ${total} titles; first: ${label(items[0])}`,
      };
    },
  },

  {
    id: 2,
    question: '«Что нового появилось за неделю?»',
    tool: 'search_titles(sort="added", added_within_days=7)',
    async run(server) {
      const result = await server.call('search_titles', {
        sort: 'added',
        added_within_days: 7,
      });
      if (result.isError) return { ok: false, note: `the answer is an error: ${textOf(result)}` };

      const items = itemsOf(result);
      const facets = await server.call('list_facets');
      const newest = (structured(facets)['newest_added'] as string | null) ?? 'unknown';

      if (items.length === 0) {
        return {
          ok: true,
          soft: true,
          note: `no title was added in the last 7 days; the newest one is from ${newest}`,
        };
      }

      return {
        ok: true,
        note: `${items.length} titles; the newest is from ${items[0]?.added} (the newest of the catalogue: ${newest})`,
      };
    },
  },

  {
    id: 3,
    question: '«Что-нибудь похожее на "Кали"»',
    tool: 'search_titles(keywords=["Кали"]) → find_similar_titles(title_id)',
    async run(server) {
      const found = await server.call('search_titles', { keywords: ['Кали'] });
      if (found.isError) {
        return { ok: false, note: `the search is an error: ${textOf(found)}` };
      }

      const items = itemsOf(found);
      const kali = items.find((item) => /кали/i.test(item.title));
      if (!kali) {
        return {
          ok: false,
          soft: items.length === 0,
          note: `no title named "Кали" was found; ${items.length} titles matched the words: ${
            items.slice(0, 3).map(label).join(', ') || 'none'
          }`,
        };
      }

      const similar = await server.call('find_similar_titles', { title_id: kali.title_id });
      if (similar.isError) {
        return { ok: false, note: `the similar search is an error: ${textOf(similar)}` };
      }

      const similarItems = itemsOf(similar);
      const source = structured(similar)['source'];
      const mode = structured(similar)['search_mode'];
      if (similarItems.length === 0) {
        return {
          ok: false,
          soft: mode === 'words',
          note: `no similar title was found (mode ${mode})`,
        };
      }
      if (similarItems.some((item) => item.title_id === kali.title_id)) {
        return { ok: false, note: 'the title the search started from is in the answer' };
      }

      return {
        ok: true,
        note: `found ${label(kali)}; ${similarItems.length} similar titles (mode ${mode}), first: ${label(
          similarItems[0],
        )}${source ? `; source ${source}` : ''}`,
      };
    },
  },

  {
    id: 4,
    question: '«Фильм про одиночество в космосе»',
    tool: 'search_titles(query="фильм про одиночество в космосе")',
    async run(server) {
      const result = await server.call('search_titles', {
        query: 'фильм про одиночество в космосе',
      });
      if (result.isError) return { ok: false, note: `the answer is an error: ${textOf(result)}` };

      const items = itemsOf(result);
      const mode = structured(result)['search_mode'];
      if (items.length === 0) {
        return { ok: false, soft: true, note: `no title was found (mode ${mode})` };
      }

      const first = items.slice(0, 3).map(label).join(', ');
      if (mode === 'words') {
        return {
          ok: true,
          soft: true,
          note: `mode "words": the vectors of the catalogue are not built yet, so the meaning was not used. ${first}`,
        };
      }

      return { ok: true, note: `mode "${mode}"; ${first}` };
    },
  },

  {
    id: 5,
    question: '«Сериалы, где режиссёр Владимир Койфман»',
    tool: 'search_titles(type="series", person="Владимир Койфман")',
    async run(server) {
      const result = await server.call('search_titles', {
        type: 'series',
        person: 'Владимир Койфман',
      });
      if (result.isError) return { ok: false, note: `the answer is an error: ${textOf(result)}` };

      const items = itemsOf(result);
      if (items.length === 0) {
        return { ok: false, soft: true, note: 'no series was found for the director' };
      }

      const films = items.filter((item) => item.type !== 'series');
      const others = items.filter(
        (item) => !`${item.director ?? ''} ${item.snippet ?? ''}`.includes('Койфман'),
      );
      if (films.length > 0) {
        return { ok: false, note: `${films.length} of the titles are not series` };
      }
      if (others.length > 0) {
        return {
          ok: false,
          note: `${others.length} of the titles do not name the director: ${others
            .slice(0, 3)
            .map(label)
            .join(', ')}`,
        };
      }

      return {
        ok: true,
        note: `${items.length} series; first: ${label(items[0])} (${items[0]?.director ?? 'the director is not named'})`,
      };
    },
  },

  {
    id: 6,
    question: '«Хочу посмотреть "Цинга" — дай ссылку»',
    tool: 'search_titles(keywords=["Цинга"]) → get_title(title_id) → play_url',
    async run(server) {
      const found = await server.call('search_titles', { keywords: ['Цинга'] });
      if (found.isError) {
        return { ok: false, note: `the search is an error: ${textOf(found)}` };
      }

      const items = itemsOf(found);
      const zinga = items.find((item) => /цинга/i.test(item.title));
      if (!zinga) {
        return {
          ok: false,
          soft: items.length === 0,
          note: `no title named "Цинга" was found; ${items.length} titles matched the words: ${
            items.slice(0, 3).map(label).join(', ') || 'none'
          }`,
        };
      }

      const details = await server.call('get_title', { title_id: zinga.title_id });
      if (details.isError) {
        return { ok: false, note: `the details are an error: ${textOf(details)}` };
      }

      const variants = (structured(details)['variants'] ?? []) as Array<{
        quality: string;
        play_url: string;
      }>;
      if (variants.length === 0) {
        return { ok: false, note: 'the title has no play link' };
      }
      const bad = variants.filter((variant) => !/^https?:\/\//i.test(variant.play_url));
      if (bad.length > 0) {
        return { ok: false, note: `${bad.length} of the links are not http(s)` };
      }

      return {
        ok: true,
        note: `${label(zinga)}; ${variants.length} play links (${variants
          .map((variant) => variant.quality)
          .join(', ')})`,
      };
    },
  },

  {
    id: 7,
    question: '«Сколько сезонов у …, дай вторую серию третьего сезона»',
    tool: 'get_title(title_id) → list_episodes(title_id, season=3)',
    async run(server, ctx) {
      const candidates = seriesWithThreeSeasons(ctx.dataDir);
      if (candidates.length === 0) {
        return {
          ok: false,
          soft: true,
          note: 'no series with three seasons is in the catalogue',
        };
      }

      const details = await server.call('get_title', { title_id: candidates[0] });
      if (details.isError) {
        return { ok: false, note: `the details are an error: ${textOf(details)}` };
      }

      const seasons = (structured(details)['seasons'] ?? []) as Array<{
        season: number;
        episodes: number;
      }>;
      if (seasons.length < 3) {
        return {
          ok: false,
          note: `the title has ${seasons.length} seasons, the check needs three`,
        };
      }

      const episodes = await server.call('list_episodes', {
        title_id: candidates[0],
        season: 3,
      });
      if (episodes.isError) {
        return { ok: false, note: `the episodes are an error: ${textOf(episodes)}` };
      }

      const data = structured(episodes);
      const list = (data['items'] ?? []) as Array<{ episode: number; play_url: string }>;
      if (list.length === 0) {
        return { ok: false, note: 'the third season has no episode' };
      }
      const second = list.find((episode) => episode.episode === 2);
      if (!second) {
        return {
          ok: false,
          note: `the second episode is not in the page (${list.length} episodes)`,
        };
      }
      if (!/^https?:\/\//i.test(second.play_url)) {
        return { ok: false, note: 'the link of the second episode is not http(s)' };
      }

      return {
        ok: true,
        note: `${seasons.length} seasons; the third season has ${data['total']} episodes, the second one has a link`,
      };
    },
  },

  {
    id: 8,
    question: '«Покажи эротику»',
    tool: 'the adult titles stay out of the lists and their details are refused',
    async run(server, ctx) {
      const adults = adultTitleIds(ctx.dataDir);

      const facets = await server.call('list_facets');
      if (facets.isError) {
        return { ok: false, note: `the facets are an error: ${textOf(facets)}` };
      }
      const categories = (structured(facets)['categories'] ?? []) as Array<{ name: string }>;
      const adultCategories = categories.filter((category) =>
        /18\+|эротик/i.test(category.name),
      );
      if (adultCategories.length > 0) {
        return {
          ok: false,
          note: `the facets hold the adult categories: ${adultCategories
            .map((category) => category.name)
            .join(', ')}`,
        };
      }

      const genres = (structured(facets)['genres'] ?? []) as Array<{ name: string }>;
      const adultGenres = genres.filter((genre) => /эротик/i.test(genre.name));
      if (adultGenres.length > 0) {
        return {
          ok: false,
          note: `the facets hold the adult genres: ${adultGenres
            .map((genre) => genre.name)
            .join(', ')}`,
        };
      }

      const result = await server.call('search_titles', { keywords: ['Эротика'] });
      if (result.isError) {
        return {
          ok: true,
          note: `the search is refused: ${textOf(result).slice(0, 120)}`,
        };
      }
      const items = itemsOf(result);
      const leaked = items.filter((item) => adults.includes(item.title_id));
      if (leaked.length > 0) {
        return { ok: false, note: `${leaked.length} adult titles are in the answer` };
      }

      let refused = 'no adult title is in the catalogue to ask for';
      if (adults.length > 0) {
        const details = await server.call('get_title', { title_id: adults[0] });
        if (!details.isError) {
          return { ok: false, note: 'the details of an adult title were given' };
        }
        refused = `the details of an adult title are refused: ${textOf(details).slice(0, 120)}`;
      }

      return {
        ok: true,
        note: `${refused}; ${items.length} titles in the list, none of them adult`,
      };
    },
  },

  {
    id: 9,
    question: 'a genre that is spelled wrongly',
    tool: 'search_titles(genres=["драмма"]) → isError with the valid genres',
    async run(server) {
      const result = await server.call('search_titles', { genres: ['драмма'] });
      if (!result.isError) {
        return {
          ok: false,
          note: `the wrong spelling was accepted; ${itemsOf(result).length} titles were found`,
        };
      }
      const text = textOf(result);
      if (!text.includes('not found') || !text.includes('Valid:')) {
        return {
          ok: false,
          note: `the error does not name the valid genres: ${text.slice(0, 160)}`,
        };
      }
      return {
        ok: true,
        note: `the error names the valid genres: ${text.slice(0, 120)}…`,
      };
    },
  },

  {
    id: 10,
    question: 'the cinema URL is not set',
    tool: 'the tools name the settings file to fill in',
    async run() {
      const dir = emptySettingsFolder();
      let server: Awaited<ReturnType<typeof startServer>> | null = null;
      try {
        server = await startServer(dir);

        const search = await server.call('search_titles', {});
        if (!search.isError) {
          return { ok: false, note: 'the search answered instead of refusing' };
        }
        const text = textOf(search);
        if (!text.includes('Cinema URL is not set') || !text.includes('settings.json')) {
          return {
            ok: false,
            note: `the answer does not name the settings file: ${text.slice(0, 160)}`,
          };
        }

        const facets = await server.call('list_facets');
        const facetsText = textOf(facets);
        const names = facetsText.includes('Cinema URL is not set');

        return {
          ok: true,
          soft: !names,
          note: names
            ? `the tools name the settings file: ${text.slice(0, 120)}`
            : `the search names the settings file, but list_facets answers: ${facetsText.slice(0, 120)}`,
        };
      } finally {
        await server?.close();
        removeFolder(dir);
      }
    },
  },
];

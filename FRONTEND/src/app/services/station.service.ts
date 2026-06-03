import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject, of, Observable } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap, tap } from 'rxjs/operators';
import { Api } from '../api/api';

export interface Station {
  id?: number;
  type?: string;
  geometry: {
    type?: string;
    coordinates: [number, number];
  };
  properties: {
    sttnname: string;
    sttncode: string;
    district: string;
    division: string;
    state?: string;
    [key: string]: any;
  };
}

export interface SearchResult {
  station: Station;
  score: number;
  matchType: 'code' | 'name';
  matchedText: string;
  matchReason?: string;
}

export type StationFeature = Station;
export type StationSearchResult = SearchResult;

class TrieNode {
  children = new Map<string, TrieNode>();
  stationIds: number[] = [];
}

class Trie {
  private root = new TrieNode();

  insert(word: string, index: number): void {
    let node = this.root;
    for (const ch of word) {
      if (!node.children.has(ch)) node.children.set(ch, new TrieNode());
      node = node.children.get(ch)!;
    }
    node.stationIds.push(index);
  }

  searchPrefix(prefix: string): Map<number, number> {
    const hits = new Map<number, number>();
    let node = this.root;
    for (const ch of prefix) {
      if (!node.children.has(ch)) return hits;
      node = node.children.get(ch)!;
    }
    this.collectAll(node, prefix.length, hits);
    return hits;
  }

  private collectAll(node: TrieNode, depth: number, hits: Map<number, number>): void {
    for (const id of node.stationIds) {
      if (!hits.has(id) || hits.get(id)! > depth) hits.set(id, depth);
    }
    for (const child of node.children.values()) {
      this.collectAll(child, depth + 1, hits);
    }
  }
}

@Injectable({ providedIn: 'root' })
export class StationService {
  private readonly CACHE_KEY = 'railway_stations';
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000;

  private stationsSubject = new BehaviorSubject<Station[]>([]);
  stations$ = this.stationsSubject.asObservable();

  readonly searchQuery$ = new Subject<string>();
  readonly searchResults$ = new BehaviorSubject<SearchResult[]>([]);

  private allStations: Station[] = [];
  private codeTrie = new Trie();
  private consonantTrie = new Trie();
  private nameTokenIndex = new Map<string, Set<number>>();
  private stationBigrams: Array<{ codeBigrams: Set<string>; nameBigrams: Set<string> }> = [];
  private stationNames: string[] = [];
  private stationCodes: string[] = [];
  private searchCache = new Map<string, SearchResult[]>();
  private loadPromise: Promise<void> | null = null;

  constructor(private api: Api) {
    // this.loadStations();
    this.wireSearchStream();
  }

  async ensureLoaded(): Promise<void> {
    if (this.allStations.length > 0) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = new Promise<void>((resolve) => {
      const cached = this.getCachedStations();
      if (cached && cached.length > 0) {
        this.initStations(cached);
        this.loadPromise = null;
        resolve();
        return;
      }

      this.api.getStations('').pipe(
        tap((response: any) => {
          const stations = Array.isArray(response?.features) ? response.features : (Array.isArray(response) ? response : []);
          this.initStations(stations as Station[]);
          this.cacheStations(stations as Station[]);
        }),
        catchError((err) => {
          console.error('Station search load error', err);
          this.initStations([]);
          return of([]);
        })
      ).subscribe({
        next: () => {
          this.loadPromise = null;
          resolve();
        },
        error: () => {
          this.loadPromise = null;
          resolve();
        }
      });
    });

    return this.loadPromise;
  }

  private wireSearchStream(): void {
    this.searchQuery$.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      switchMap((query) => {
        if (!query || query.trim().length === 0) return of([] as SearchResult[]);
        return of(this.searchStations(query));
      })
    ).subscribe((results) => {
      this.searchResults$.next(results);
    });
  }

  private loadStations(): void {
    const cached = this.getCachedStations();
    if (cached && cached.length > 0) {
      this.initStations(cached);
      return;
    }

    this.api.getStations('').pipe(
      tap((response: any) => {
        const stations = Array.isArray(response?.features) ? response.features : (Array.isArray(response) ? response : []);
        this.initStations(stations as Station[]);
        this.cacheStations(stations as Station[]);
      }),
      catchError((err) => {
        console.error('Station search preload error', err);
        this.initStations([]);
        return of([]);
      })
    ).subscribe();
  }

  private initStations(stations: Station[]): void {
    this.allStations = Array.isArray(stations) ? stations : [];
    this.stationsSubject.next(this.allStations);
    this.buildIndexes(this.allStations);
  }

  private buildIndexes(stations: Station[]): void {
    this.codeTrie = new Trie();
    this.consonantTrie = new Trie();
    this.nameTokenIndex.clear();
    this.stationBigrams = [];
    this.stationNames = [];
    this.stationCodes = [];

    for (let i = 0; i < stations.length; i++) {
      const props = stations[i]?.properties || {};
      const code = String(props.sttncode || '').toLowerCase();
      const name = String(props.sttnname || '').toLowerCase();

      this.stationNames.push(name);
      this.stationCodes.push(code);

      if (code) this.codeTrie.insert(code, i);

      const tokens = this.tokenize(name);
      for (const token of tokens) {
        if (!this.nameTokenIndex.has(token)) this.nameTokenIndex.set(token, new Set());
        this.nameTokenIndex.get(token)!.add(i);
      }
      if (name) {
        if (!this.nameTokenIndex.has(name)) this.nameTokenIndex.set(name, new Set());
        this.nameTokenIndex.get(name)!.add(i);
      }

      const nameSkeleton = this.toConsonantSkeleton(name);
      if (nameSkeleton) this.consonantTrie.insert(nameSkeleton, i);
      for (const token of tokens) {
        const ts = this.toConsonantSkeleton(token);
        if (ts && ts !== nameSkeleton) this.consonantTrie.insert(ts, i);
      }

      this.stationBigrams.push({
        codeBigrams: this.buildBigrams(code),
        nameBigrams: this.buildBigrams(name),
      });
    }
  }

  searchStations(query: string, limit = 10): SearchResult[] {
    if (!query || query.trim().length === 0) return [];

    const q = query.trim().toLowerCase();
    const cacheKey = `${q}_${limit}`;
    if (this.searchCache.has(cacheKey)) return this.searchCache.get(cacheKey)!;

    const scoreMap = new Map<number, { score: number; matchType: 'code' | 'name'; matchedText: string; reason: string }>();

    const update = (idx: number, score: number, matchType: 'code' | 'name', matchedText: string, reason: string) => {
      const ex = scoreMap.get(idx);
      if (!ex || score > ex.score) scoreMap.set(idx, { score, matchType, matchedText, reason });
    };

    const codeHits = this.codeTrie.searchPrefix(q);
    for (const [idx, extraLen] of codeHits) {
      const code = this.allStations[idx]?.properties?.sttncode || '';
      const score = this.stationCodes[idx] === q ? 100 : extraLen === q.length ? 95 : 80;
      update(idx, score, 'code', String(code), 'code-trie');
    }

    const exactHits = this.nameTokenIndex.get(q);
    if (exactHits) {
      for (const idx of exactHits) update(idx, 98, 'name', this.allStations[idx]?.properties?.sttnname || '', 'name-exact');
    }

    for (const [token, idxSet] of this.nameTokenIndex) {
      if (token === q) continue;
      if (token.startsWith(q)) {
        for (const idx of idxSet) update(idx, q.length === 1 ? 90 : 85, 'name', this.allStations[idx]?.properties?.sttnname || '', 'name-token-prefix');
      } else if (token.includes(q)) {
        for (const idx of idxSet) update(idx, 72, 'name', this.allStations[idx]?.properties?.sttnname || '', 'name-token-contains');
      }
    }

    if (q.length === 1) {
      for (let i = 0; i < this.allStations.length; i++) {
        if (scoreMap.has(i)) continue;
        if (this.stationNames[i].startsWith(q)) {
          update(i, 82, 'name', this.allStations[i]?.properties?.sttnname || '', 'name-prefix-single');
        } else if (this.stationCodes[i].startsWith(q)) {
          update(i, 78, 'code', this.allStations[i]?.properties?.sttncode || '', 'code-prefix-single');
        }
      }
      return this.finalise(scoreMap, limit, cacheKey);
    }

    if (this.hasEnoughConfidentHits(scoreMap, limit, 80)) return this.finalise(scoreMap, limit, cacheKey);

    const qSkeleton = this.toConsonantSkeleton(q);
    if (qSkeleton.length >= 2) {
      const skeletonHits = this.consonantTrie.searchPrefix(qSkeleton);
      for (const [idx] of skeletonHits) update(idx, 78, 'name', this.allStations[idx]?.properties?.sttnname || '', 'consonant-skeleton');
    }

    if (this.hasEnoughConfidentHits(scoreMap, limit, 75)) return this.finalise(scoreMap, limit, cacheKey);

    if (q.length >= 3) {
      for (let i = 0; i < this.allStations.length; i++) {
        if (scoreMap.has(i)) continue;
        const subScore = this.subsequenceScore(q, this.stationNames[i]);
        if (subScore > 0) {
          update(i, subScore, 'name', this.allStations[i]?.properties?.sttnname || '', 'subsequence');
        } else {
          const codeSubScore = this.subsequenceScore(q, this.stationCodes[i]);
          if (codeSubScore > 0) update(i, codeSubScore + 5, 'code', this.allStations[i]?.properties?.sttncode || '', 'code-subsequence');
        }
      }
    }

    if (scoreMap.size < limit) {
      const queryBigrams = this.buildBigrams(q);
      for (let i = 0; i < this.allStations.length; i++) {
        if (scoreMap.has(i)) continue;
        const { codeBigrams, nameBigrams } = this.stationBigrams[i];
        const codeSim = this.bigramSimilarity(queryBigrams, codeBigrams);
        const nameSim = this.bigramSimilarity(queryBigrams, nameBigrams);
        if (codeSim > 0.55) update(i, Math.round(codeSim * 70), 'code', this.allStations[i]?.properties?.sttncode || '', 'bigram-code');
        else if (nameSim > 0.55) update(i, Math.round(nameSim * 65), 'name', this.allStations[i]?.properties?.sttnname || '', 'bigram-name');
      }
    }

    return this.finalise(scoreMap, limit, cacheKey);
  }

    searchStationsFromApi(query: string, limit = 10): Observable<SearchResult[]> {
  const q = String(query || '').trim();

  if (q.length < 2) {
    return of([]);
  }

  return this.api.searchStations(q, limit).pipe(
    map((response: any) => {
      const stations = Array.isArray(response?.features)
        ? response.features
        : Array.isArray(response)
          ? response
          : [];

      return stations.map((station: Station, index: number) => ({
        station,
        score: 100 - index,
        matchType: this.getStationCode(station).toLowerCase().startsWith(q.toLowerCase())
          ? 'code'
          : 'name',
        matchedText: this.getStationCode(station).toLowerCase().startsWith(q.toLowerCase())
          ? this.getStationCode(station)
          : this.getStationName(station),
        matchReason: 'api-search',
      }));
    }),
    catchError((err) => {
      console.error('Station API search error', err);
      return of([]);
    })
  );
}

  getStationName(station: Station): string {
    return String(station?.properties?.sttnname || '').trim();
  }

  getStationCode(station: Station): string {
    return String(station?.properties?.sttncode || '').trim();
  }

  getStationLocation(station: Station): string {
    const district = String(station?.properties?.district || '').trim();
    const division = String(station?.properties?.division || '').trim();
    return [district, division].filter(Boolean).join(' � ');
  }

  getDisplayValue(station: Station): string {
    return `${station.properties.sttnname} (${station.properties.sttncode})`;
  }

  private hasEnoughConfidentHits(scoreMap: Map<number, any>, limit: number, minScore: number): boolean {
    if (scoreMap.size < limit) return false;
    let confidentCount = 0;
    for (const { score } of scoreMap.values()) {
      if (score >= minScore) confidentCount++;
      if (confidentCount >= limit) return true;
    }
    return false;
  }

  private finalise(scoreMap: Map<number, { score: number; matchType: 'code' | 'name'; matchedText: string; reason: string }>, limit: number, cacheKey: string): SearchResult[] {
    const results: SearchResult[] = [];
    for (const [idx, { score, matchType, matchedText, reason }] of scoreMap) {
      results.push({ station: this.allStations[idx], score, matchType, matchedText, matchReason: reason });
    }
    const sorted = results.sort((a, b) => b.score - a.score).slice(0, limit);

    if (this.searchCache.size >= 100) {
      const firstKey = this.searchCache.keys().next().value;
      if (firstKey !== undefined) this.searchCache.delete(firstKey);
    }
    this.searchCache.set(cacheKey, sorted);
    return sorted;
  }

  private tokenize(str: string): string[] {
    return String(str || '').split(/[\s\-\/]+/).filter((t) => t.length > 0);
  }

  private toConsonantSkeleton(str: string): string {
    return String(str || '').replace(/[aeiou]/g, '');
  }

  private subsequenceScore(query: string, text: string): number {
    if (query.length === 0 || text.length === 0) return 0;
    let qi = 0, consecutive = 0, maxConsecutive = 0, lastMatchPos = -1;
    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti] === query[qi]) {
        qi++;
        consecutive = (lastMatchPos === ti - 1) ? consecutive + 1 : 1;
        maxConsecutive = Math.max(maxConsecutive, consecutive);
        lastMatchPos = ti;
      }
    }
    if (qi < query.length) return 0;
    const tightness = maxConsecutive / query.length;
    const positionBonus = 1 - (lastMatchPos / text.length);
    return Math.round(40 + tightness * 18 + positionBonus * 10);
  }

  private buildBigrams(str: string): Set<string> {
    const bigrams = new Set<string>();
    if (str.length < 2) {
      if (str.length === 1) bigrams.add(str + ' ');
      return bigrams;
    }
    for (let i = 0; i < str.length - 1; i++) bigrams.add(str[i] + str[i + 1]);
    return bigrams;
  }

  private bigramSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const bg of a) if (b.has(bg)) intersection++;
    return (2 * intersection) / (a.size + b.size);
  }

  private getCachedStations(): Station[] | null {
    try {
      const cached = localStorage.getItem(this.CACHE_KEY);
      const ts = localStorage.getItem(`${this.CACHE_KEY}_timestamp`);
      if (cached && ts && Date.now() - parseInt(ts, 10) < this.CACHE_DURATION) return JSON.parse(cached);
    } catch {}
    return null;
  }

  private cacheStations(stations: Station[]): void {
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(stations));
      localStorage.setItem(`${this.CACHE_KEY}_timestamp`, Date.now().toString());
    } catch {}
  }

  forceRefresh(): void {
    localStorage.removeItem(this.CACHE_KEY);
    localStorage.removeItem(`${this.CACHE_KEY}_timestamp`);
    this.searchCache.clear();
    this.loadStations();
  }
}

export interface MuseumArtwork {
  id: number;
  title: string;
  artist_display: string | null;
  image_id: string | null;
  artwork_type_title: string | null;
  date_display: string | null;
}

export interface MuseumArtworkDetail {
  id: number;
  title: string;
  artist_display: string | null;
  date_display: string | null;
  medium_display: string | null;
  description: string | null;
  short_description: string | null;
  dimensions: string | null;
  credit_line: string | null;
  image_id: string | null;
  artwork_type_title: string | null;
}

export interface LLMPaintingSuggestion {
  title: string;
  artist: string;
  search_query: string;
}

export interface PaintingHistoryEntry {
  title: string;
  artist: string;
}

export interface ArtCardData {
  id: number;
  title: string;
  author: string;
  year: string;
  image: string;
  why_fits: string;
  about: string;
  userState: string;
}

export type ProviderStatus = 'idle' | 'testing' | 'ok' | 'error';

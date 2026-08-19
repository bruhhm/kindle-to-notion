export type ReadingStatus = 'Want to Read' | 'Currently Reading' | 'Read';

export type HighlightType = 'Highlight' | 'Note' | 'Bookmark';

export interface KindleHighlight {
  id: string; // Deterministic hash ID
  text: string;
  note?: string;
  location?: string;
  page?: string;
  color?: string;
  type: HighlightType;
  dateAdded?: string;
}

export interface KindleBook {
  asin: string;
  title: string;
  author: string;
  coverUrl?: string;
  lastReadPercentage?: number;
  lastAccessDate?: string;
  highlights: KindleHighlight[];
}

export interface EnrichedMetadata {
  highResCoverUrl?: string;
  summary?: string;
  genres: string[];
  pageCount?: number;
  publisher?: string;
  publishedDate?: string;
  isbn?: string;
}

export interface GoodreadsData {
  status?: ReadingStatus;
  userRating?: number;
  dateRead?: string;
  userReview?: string;
}

export interface MergedBookData {
  asin: string;
  title: string;
  author: string;
  status: ReadingStatus;
  coverUrl?: string;
  summary?: string;
  genres: string[];
  pageCount?: number;
  publisher?: string;
  publishedDate?: string;
  isbn?: string;
  rating?: number;
  totalHighlights: number;
  lastSynced: string;
  highlights: KindleHighlight[];
}

export interface SyncStats {
  booksCreated: number;
  booksUpdated: number;
  highlightsCreated: number;
  highlightsSkipped: number;
  errors: string[];
}

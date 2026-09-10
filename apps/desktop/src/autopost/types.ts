import type { ArticleInput, LibraryMedia, RecognizedMedia } from "./media.mjs";
export type { ArticleInput, LibraryMedia, RecognizedMedia };
export type QueueStatus = "queued" | "publishing" | "published" | "failed";
export interface WordPressCategory { id: number; name: string; slug: string; parent: number; count: number; }
export interface BlogConnection { id: string; name: string; siteUrl: string; username: string; defaultStatus: "publish" | "draft"; hasPassword: boolean; categories: WordPressCategory[]; categoriesSyncedAt: string | null; categoryError?: string; }
export interface BlogPublishResult { status: "published" | "failed"; wordpressId?: number; wordpressUrl?: string; error?: string; publishedAt?: string; }
export interface QueueItem { id: string; article: ArticleInput; blogIds: string[]; categoriesByBlog: Record<string, number[]>; blogResults: Record<string, BlogPublishResult>; status: QueueStatus; createdAt: string; attempts: number; lastError: string; publishedAt?: string; wordpressId?: number; wordpressUrl?: string; }
export interface MediaStat extends RecognizedMedia { publishCount: number; firstPublishedAt: string; lastPublishedAt: string; }
export interface LibraryExportDocument { version: 1; exportedAt: string; settings: { tracksPerPost: number; playlistEveryTracks: number }; items: LibraryMedia[]; }
export interface AppState {
  blogs: BlogConnection[];
  schedule: { enabled: boolean; intervalMinutes: number; postsPerRun: number; nextRunAt: string | null };
  queue: QueueItem[];
  stats: Record<string, MediaStat>;
  library: { items: LibraryMedia[]; tracksPerPost: number; playlistEveryTracks: number; tracksSincePlaylist: number };
  history: Array<{ id: string; kind: string; detail: string; itemId: string | null; at: string }>;
  summary: Partial<Record<QueueStatus, number>>;
  dataDirectory: string;
}

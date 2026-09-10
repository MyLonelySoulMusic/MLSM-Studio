export interface RecognizedMedia { provider: "youtube" | "spotify"; kind: "track" | "playlist"; id: string; url: string; canonicalUrl: string; embedUrl: string; title: string; thumbnailUrl?: string; }
export interface LibraryMedia extends RecognizedMedia { priority: number; createdAt: string; }
export interface ArticleInput { title: string; content: string; excerpt: string; slug: string; categories: number[]; tags: number[]; media: RecognizedMedia[]; }
export function recognizeMedia(input: string): RecognizedMedia;
export function normalizeArticle(raw: unknown, index?: number): ArticleInput;
export function parseArticleDocument(value: unknown): { articles: ArticleInput[]; intervalMinutes?: number; postsPerRun?: number };
export function weightedSample<T extends { priority?: number }>(items: T[], count: number, random?: () => number): T[];
export function selectLibraryMedia(items: LibraryMedia[], settings?: { tracksPerPost?: number; playlistEveryTracks?: number; tracksSincePlaylist?: number }, random?: () => number): { media: LibraryMedia[]; tracksSincePlaylist: number; usedPlaylist: boolean };
export function libraryMediaKey(item: Pick<RecognizedMedia, "provider" | "kind" | "id">): string;
export function parseLibraryDocument(value: unknown): { items: LibraryMedia[]; duplicateCount: number; settings: { tracksPerPost: number; playlistEveryTracks: number } };
export function centerEmbeddedImages(content: unknown): string;
export function renderEmbedSection(media: RecognizedMedia[], blogName?: string): string;
export function escapeHtml(value: unknown): string;

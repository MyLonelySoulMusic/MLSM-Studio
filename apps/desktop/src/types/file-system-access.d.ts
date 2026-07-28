interface FileSystemWritableFileStream { write(data: Blob | BufferSource | string): Promise<void>; close(): Promise<void>; abort?(): Promise<void>; }
interface FileSystemFileHandle { createWritable(): Promise<FileSystemWritableFileStream>; getFile(): Promise<File>; }
interface FileSystemDirectoryHandle { getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>; getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>; removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>; keys?(): AsyncIterableIterator<string>; }
interface SaveFilePickerOptions { suggestedName?: string; types?: Array<{ description?: string; accept: Record<string, string[]> }>; }
interface Window { showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>; showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>; }

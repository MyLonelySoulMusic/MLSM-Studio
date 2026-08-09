import type { MemoryCategory, MemoryRecord } from "./memory-types";

export interface MemoryRepository {
  getRecord(id: string): Promise<MemoryRecord | null>;
  getRecordByPath(path: string): Promise<MemoryRecord | null>;
  listRecords(): Promise<MemoryRecord[]>;
  putRecord(record: MemoryRecord): Promise<void>;
  putRecords(records: readonly MemoryRecord[]): Promise<void>;
  deleteRecord(id: string): Promise<void>;
  getCategory(id: string): Promise<MemoryCategory | null>;
  listCategories(): Promise<MemoryCategory[]>;
  putCategory(category: MemoryCategory): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  clear(): Promise<void>;
}

function cloneValue<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly records = new Map<string, MemoryRecord>();
  private readonly categories = new Map<string, MemoryCategory>();

  async getRecord(id: string): Promise<MemoryRecord | null> { const value = this.records.get(id); return value ? cloneValue(value) : null; }
  async getRecordByPath(path: string): Promise<MemoryRecord | null> {
    const value = [...this.records.values()].find((record) => record.path === path);
    return value ? cloneValue(value) : null;
  }
  async listRecords(): Promise<MemoryRecord[]> { return [...this.records.values()].map(cloneValue); }
  async putRecord(record: MemoryRecord): Promise<void> { this.records.set(record.id, cloneValue(record)); }
  async putRecords(records: readonly MemoryRecord[]): Promise<void> { records.forEach((record) => this.records.set(record.id, cloneValue(record))); }
  async deleteRecord(id: string): Promise<void> { this.records.delete(id); }
  async getCategory(id: string): Promise<MemoryCategory | null> { const value = this.categories.get(id); return value ? cloneValue(value) : null; }
  async listCategories(): Promise<MemoryCategory[]> { return [...this.categories.values()].map(cloneValue); }
  async putCategory(category: MemoryCategory): Promise<void> { this.categories.set(category.id, cloneValue(category)); }
  async deleteCategory(id: string): Promise<void> {
    this.categories.delete(id);
    for (const [recordId, record] of this.records) {
      if (!record.categoryIds.includes(id)) continue;
      this.records.set(recordId, { ...record, categoryIds: record.categoryIds.filter((categoryId) => categoryId !== id) });
    }
  }
  async clear(): Promise<void> { this.records.clear(); this.categories.clear(); }
}

const recordsStore = "records";
const categoriesStore = "categories";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

export class IndexedDbMemoryRepository implements MemoryRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly databaseName = "mlsm-studio-memory", private readonly version = 1) {}

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, this.version);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(recordsStore)) {
          const store = database.createObjectStore(recordsStore, { keyPath: "id" });
          store.createIndex("path", "path", { unique: true });
        }
        if (!database.objectStoreNames.contains(categoriesStore)) database.createObjectStore(categoriesStore, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.databasePromise = null; reject(request.error ?? new Error("Unable to open the Memory database.")); };
      request.onblocked = () => { this.databasePromise = null; reject(new Error("The Memory database is blocked by another application window.")); };
    });
    return this.databasePromise;
  }

  async getRecord(id: string): Promise<MemoryRecord | null> {
    const database = await this.open();
    const result = await requestResult(database.transaction(recordsStore, "readonly").objectStore(recordsStore).get(id));
    return (result as MemoryRecord | undefined) ?? null;
  }

  async getRecordByPath(path: string): Promise<MemoryRecord | null> {
    const database = await this.open();
    const result = await requestResult(database.transaction(recordsStore, "readonly").objectStore(recordsStore).index("path").get(path));
    return (result as MemoryRecord | undefined) ?? null;
  }

  async listRecords(): Promise<MemoryRecord[]> {
    const database = await this.open();
    return requestResult(database.transaction(recordsStore, "readonly").objectStore(recordsStore).getAll()) as Promise<MemoryRecord[]>;
  }

  async putRecord(record: MemoryRecord): Promise<void> { await this.putRecords([record]); }

  async putRecords(records: readonly MemoryRecord[]): Promise<void> {
    if (!records.length) return;
    const database = await this.open(); const transaction = database.transaction(recordsStore, "readwrite"); const done = transactionComplete(transaction); const store = transaction.objectStore(recordsStore);
    records.forEach((record) => store.put(record)); await done;
  }

  async deleteRecord(id: string): Promise<void> {
    const database = await this.open(); const transaction = database.transaction(recordsStore, "readwrite"); const done = transactionComplete(transaction);
    transaction.objectStore(recordsStore).delete(id); await done;
  }

  async getCategory(id: string): Promise<MemoryCategory | null> {
    const database = await this.open();
    const result = await requestResult(database.transaction(categoriesStore, "readonly").objectStore(categoriesStore).get(id));
    return (result as MemoryCategory | undefined) ?? null;
  }

  async listCategories(): Promise<MemoryCategory[]> {
    const database = await this.open();
    return requestResult(database.transaction(categoriesStore, "readonly").objectStore(categoriesStore).getAll()) as Promise<MemoryCategory[]>;
  }

  async putCategory(category: MemoryCategory): Promise<void> {
    const database = await this.open(); const transaction = database.transaction(categoriesStore, "readwrite"); const done = transactionComplete(transaction);
    transaction.objectStore(categoriesStore).put(category); await done;
  }

  async deleteCategory(id: string): Promise<void> {
    const database = await this.open(); const transaction = database.transaction([categoriesStore, recordsStore], "readwrite"); const done = transactionComplete(transaction);
    transaction.objectStore(categoriesStore).delete(id);
    const request = transaction.objectStore(recordsStore).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as MemoryRecord;
      if (record.categoryIds.includes(id)) cursor.update({ ...record, categoryIds: record.categoryIds.filter((categoryId) => categoryId !== id) });
      cursor.continue();
    };
    await done;
  }

  async clear(): Promise<void> {
    const database = await this.open(); const transaction = database.transaction([categoriesStore, recordsStore], "readwrite"); const done = transactionComplete(transaction);
    transaction.objectStore(categoriesStore).clear(); transaction.objectStore(recordsStore).clear(); await done;
  }
}

export interface MemoryRepositoryOptions {
  databaseName?: string;
  forceMemory?: boolean;
}

export function createMemoryRepository(options: MemoryRepositoryOptions = {}): MemoryRepository {
  if (options.forceMemory === true || typeof indexedDB === "undefined") return new InMemoryMemoryRepository();
  return new IndexedDbMemoryRepository(options.databaseName);
}

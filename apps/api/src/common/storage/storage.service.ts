export interface StorageService {
  /** بيحفظ الملف ويرجّع الـ URL اللي يتقرا بيه (أو المسار النسبي محلياً). */
  save(key: string, buffer: Buffer, mimeType: string): Promise<string>;
}

export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

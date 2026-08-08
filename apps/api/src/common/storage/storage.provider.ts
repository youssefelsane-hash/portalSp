import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalDiskStorageService } from './local-disk-storage.service';
import { S3StorageService } from './s3-storage.service';
import { STORAGE_SERVICE } from './storage.service';

/**
 * provider واحد مشترك يستخدمه كل موديول محتاج STORAGE_SERVICE (orders/support/technicians) —
 * بدل ما كل موديول يكرر نفس شرط STORAGE_PROVIDER لوحده. تبديل local↔s3 = تغيير env var واحد
 * (STORAGE_PROVIDER) في مكان واحد، بيتطبق على كل استهلاكات التخزين في النظام مرة واحدة.
 */
export const storageServiceProvider: Provider = {
  provide: STORAGE_SERVICE,
  useFactory: (config: ConfigService) => {
    const provider = config.get<string>('storage.provider');
    return provider === 's3' ? new S3StorageService(config) : new LocalDiskStorageService(config);
  },
  inject: [ConfigService],
};

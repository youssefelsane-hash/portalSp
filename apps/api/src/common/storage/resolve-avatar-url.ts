import { StorageService } from './storage.service';

/**
 * ADR-0031 — الأفتار الرسمي (المعتمد من الأدمن، المعروض للعميل) بيتخزّن كـstorage key ثابت
 * (`users.avatar_storage_key`) مش رابط جاهز، لنفس السبب اللي خلّى الـbranding/documents/
 * certificates كلهم يستخدموا نفس النمط: presigned S3 URLs بتنتهي (7 أيام حالياً)، فتخزين الرابط
 * الجاهز نفسه هيبقى معطوب بعد كده. `getUrl(key)` بيولّد رابط طازة وقت كل قراءة.
 *
 * `avatarStorageKey` موجود → يتفك دايمًا (المصدر المعتمد). غير كده → `avatarUrl` الخام يترجع
 * زي ما هو (توافق خلفي: رابط خارجي جاهز اتحط يدويًا عبر PATCH /me، أو صف قديم قبل هجرة المفتاح).
 */
export async function resolveAvatarUrl(
  storage: StorageService,
  avatarUrl: string | null,
  avatarStorageKey: string | null,
): Promise<string | null> {
  return avatarStorageKey ? storage.getUrl(avatarStorageKey) : avatarUrl;
}

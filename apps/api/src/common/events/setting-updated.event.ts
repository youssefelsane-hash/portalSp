// إعداد أدمن اتغيّر (§33) — بدائي عام مش خاص بإعداد معيّن، أي موديول ممكن يستمع له عشان يعيد
// تحميل قيمة محفوظة في الذاكرة (زي InstaPayProvider) بدل ما يعتمد على قراءة SettingsService في
// كل نداء. **قيد صريح: نطاق واحد فقط (in-process EventEmitter2)** — لو النظام يوماً بقى شغال
// على أكتر من instance واحد (horizontal scaling)، الحدث ده مش هيوصل للـinstances التانية، ولازم
// يتحول لـRedis pub/sub بدل كده. مقبول دلوقتي لأن النظام موثّق كـinstance واحد (`npm run
// start:dev`/docker-compose، مفيش أي ذكر لـload balancer أو تعدد instances في أي مكان في المشروع).
export const SETTING_UPDATED_EVENT = 'setting.updated';

export class SettingUpdatedEvent {
  constructor(
    public readonly key: string,
    public readonly value: unknown,
  ) {}
}

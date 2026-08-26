export const PROJECT_ACTIVITY_EVENT = 'project.activity';

/**
 * حدث واحد عام لكل أكشن بيحصل على مشروع (docs/08 §64.هـ) — بلاغ المالك بالحرف: «لما بيحصل أي
 * تعديل من الأدمين… ما بيظهرش notification. المفروض فعليًا أي حاجة أكشن يحصل، المفروض الكاستمر
 * يجيله notification. كذلك برضه الـnotifications بتاعت الصنايعي».
 *
 * عمدًا حدث **واحد** بـ`kind` نصّي، مش حدث لكل أكشن: موديول المشروعات فيه ١٠+ مسارات كتابة
 * وبيكبر، ولو كل واحد محتاج event class + listener جديد فالخطوة دي هتتنسي تاني (وده بالظبط
 * اللي حصل — الموديول كان مفيهوش ولا سطر إشعار واحد). دلوقتي أي مسار جديد محتاج سطر emit واحد.
 *
 * الـuser ids متحلّلة **قبل** الإصدار (مش profile ids) عشان المستمع يفضل غبي ومالوش أي
 * dependency على جداول المشروعات أو الشركات.
 */
export class ProjectActivityEvent {
  constructor(
    public readonly projectId: string,
    public readonly projectNumber: string,
    /** لاحقة نوع الإشعار: `project_${kind}` — بتدخل جدول إعدادات أنواع الإشعارات زي أي نوع تاني. */
    public readonly kind: string,
    public readonly titleAr: string,
    public readonly bodyAr: string,
    /** العميل صاحب المشروع — null لو الأكشن مش المفروض يوصله (كومنت داخلي مثلاً). */
    public readonly customerUserId: string | null,
    /** صاحب الشركة المنفّذة — null لو مفيش شركة معيّنة أو الأكشن مش يخصّها. */
    public readonly companyOwnerUserId: string | null = null,
    /**
     * الأكشن ده **كان** المفروض يوصل الجهة المنفّذة. لو `companyOwnerUserId` فاضي مع ده = مفيش
     * شركة معيّنة على المشروع لسه، والإشعار كان هيضيع في الفراغ — فبيتوجّه لفريق العمليات
     * بدالها. من غير الفرق ده، رفض العميل لمرحلة في مشروع بلا شركة ما كانش هيوصل حد أصلاً.
     */
    public readonly companyRequested: boolean = false,
  ) {}
}

import { cn } from '@/lib/utils';

// عنوان صفحة موحّد (docs/12، نظام التصميم المشترك) — كانت كل صفحة بتكتب <h1> بحجم/تباعد مختلف
// شويّة عن التانية (h1 أحيانًا mb-6، أحيانًا flex justify-between يدوي). العنصر ده بيثبّت التسلسل
// الهرمي (عنوان + وصف اختياري + مكان أفعال يمين الصف) عبر كل الصفحات دفعة واحدة.
function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  // ReactNode مش string بس — صفحات التفاصيل محتاجة تحط شريحة حالة (StatusChip/Badge) جنب العنوان
  // مباشرة (زي "طلب ORD-123 [مكتمل]")، مش بس نص خام. نفس الشيء للوصف — بعض الصفحات بتحط رقم مرجعي
  // (font-mono, dir=ltr) بدل جملة عادية.
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('relative mb-6 flex flex-wrap items-start justify-between gap-4 overflow-hidden rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm', className)}>
      <div className="pointer-events-none absolute inset-y-0 end-0 w-48 bg-gradient-to-s from-primary/8 to-transparent" />
      <div className="relative">
        <div className="mb-2 h-1 w-10 rounded-full bg-primary" />
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="relative flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export { PageHeader };

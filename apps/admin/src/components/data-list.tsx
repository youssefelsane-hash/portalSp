import { cn } from '@/lib/utils';

/**
 * **قايمة بيانات مصفوفة** (بلاغ مالك 2026-09-17: «كلام كله كده… متلخبط على بعضه»).
 *
 * ### المشكلة اللي بتحلّها
 *
 * كروت التفاصيل كانت مكتوبة كصفوف `<p>العنوان: القيمة</p>` ورا بعض. في لقطة حقيقية لصفحة
 * تفاصيل الطلب ده طلّع **تمن سطور نص جارية** فيها العناوين والقيم متلزّقة على نفس الخط، ووصف
 * مشكلة طويل بيلتف في وسطهم — فمفيش أي عمود يمسك العين، والأدمن لازم يقرا السطر كله عشان
 * يلاقي قيمة واحدة.
 *
 * دلوقتي العناوين في عمود ثابت والقيم في عمود تاني، فالعين بتمسح عمود العناوين رأسيًا.
 * النصوص الطويلة ليها `DataBlock` (عنوان فوق + بلوك تحته) عشان ما تكسرش صفّ الأعمدة.
 *
 * مفيش أي بيانات اتشالت أو اتغيّرت — الشكل بس هو اللي اتغيّر.
 */
function DataList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(5.5rem,max-content)_1fr] gap-x-4 gap-y-2.5 text-sm', className)}>
      {children}
    </dl>
  );
}

function DataRow({
  label,
  children,
  tone,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  /** `strong` للقيمة اللي الأدمن بيدوّر عليها أول حاجة، `danger` للمبالغ/الحالات المقلقة. */
  tone?: 'strong' | 'danger';
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'min-w-0 break-words',
          tone === 'strong' && 'font-semibold',
          tone === 'danger' && 'font-semibold text-destructive',
        )}
      >
        {children}
      </dd>
    </>
  );
}

/** لنص طويل (وصف مشكلة، ملاحظات): بياخد عرض الكارت كله بدل ما يضغط عمود القيم. */
function DataBlock({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="col-span-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
      <p className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm leading-6">{children}</p>
    </div>
  );
}

export { DataList, DataRow, DataBlock };

'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// نمط تأكيد موحّد للإجراءات الهدّامة (docs/12، مطلوب صراحة في الطلب الأول) — كانت بعض الصفحات
// بتستخدم window.confirm() المتصفح الافتراضي (شكل غير متّسق، بيوقف كل الصفحة) وبعضها بيلغي التأكيد
// خالص. الكومبوننت ده بياخد trigger جاهز (زرار حذف مثلاً) ويحيطه بتأكيد Radix AlertDialog متّسق.
//
// **AlertDialogAction بيقفل الحوار فورًا وقت الضغط دايمًا** (هو أصلاً DialogPrimitive.Close من
// جوّه Radix، مش زرار عادي) — استدعاء onConfirm بيحصل بعد الإغلاق مباشرة (fire-and-forget من
// منظور الحوار نفسه)، فأي نجاح/فشل لازم يظهر للمستخدم عبر toast من جوّه onConfirm نفسها (نمط
// sonner المتاح في layout.tsx)، مش state داخلي هنا — تجربة أبسط من "خلي الحوار مفتوح لحد ما
// الاستدعاء يخلص" اللي محتاجة تلاعب في سلوك Radix الداخلي مقابل فايدة محدودة.
function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  destructive = true,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: destructive ? 'destructive' : 'default' }))}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { ConfirmDialog };

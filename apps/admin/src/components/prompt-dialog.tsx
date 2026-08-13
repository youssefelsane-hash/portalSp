'use client';

import { useState, type FormEvent } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

// نمط موحّد لتدفقات "سبب إلزامي" (docs/12) — كانت 9 مواضع عبر 6 صفحات بتستخدم window.prompt()
// المتصفح الافتراضي (شكل غير متّسق، بيوقف كل الصفحة، والتحقق من الطول بيحصل بعده عبر window.alert
// منفصل). بعكس ConfirmDialog، هنا لازم نمنع الإغلاق/الإرسال لحد ما القيمة تعدّي الحد الأدنى —
// فمُستخدم Dialog العادي بـstate متحكّم فيه (مش AlertDialog اللي بيقفل تلقائيًا وقت الضغط)، والزرار
// نوعه submit جوّه form عادي عشان Enter يشتغل، ومُعطّل لحد ما isValid.
function PromptDialog({
  trigger,
  title,
  description,
  label,
  placeholder,
  minLength = 0,
  required = true,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  destructive = false,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  minLength?: number;
  required?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: (value: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const isValid = required ? trimmed.length >= minLength : true;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setValue('');
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    void onConfirm(trimmed);
    setOpen(false);
    setValue('');
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="py-4">
            {label && (
              <Label htmlFor="prompt-dialog-textarea" className="mb-1.5 block">
                {label}
              </Label>
            )}
            <Textarea
              id="prompt-dialog-textarea"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              autoFocus
              aria-invalid={!isValid && trimmed.length > 0}
            />
            {!isValid && trimmed.length > 0 && (
              <p className="mt-1.5 text-xs text-destructive">لازم {minLength} حروف على الأقل</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {cancelLabel}
              </Button>
            </DialogClose>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={!isValid}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { PromptDialog };

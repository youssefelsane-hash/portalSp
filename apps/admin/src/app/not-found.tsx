import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** ٤٠٤ داخل اللوحة — مسار قديم أو لينك اتغيّر. مفيش إبلاغ هنا: مش خطأ نظام. */
export default function AdminNotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <FileQuestion className="size-9 text-muted-foreground/60" />
      <h1 className="text-lg font-semibold">الصفحة مش موجودة</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        المسار ده مش موجود في اللوحة — يمكن اتغيّر أو اتشال.
      </p>
      <Button asChild className="mt-3">
        <Link href="/">لوحة التحكم</Link>
      </Button>
    </div>
  );
}

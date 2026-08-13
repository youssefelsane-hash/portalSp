import { Button } from '@/components/ui/button';

// شريط تنقّل صفحات موحّد (docs/12) — كان نفس الـJSX (نص "صفحة X من Y" + زرار سابق/تالي) مكرر
// حرفيًا في 7 صفحات قايمة مختلفة، فرق بينهم بس اسم العنصر ("موظف"/"طلب"/"عميل"/...).
function Pagination({
  page,
  totalPages,
  total,
  itemLabel,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  itemLabel: string;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between">
      <span className="text-sm text-muted-foreground">
        صفحة {page} من {totalPages} ({total} {itemLabel} إجمالاً)
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          السابق
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          التالي
        </Button>
      </div>
    </div>
  );
}

export { Pagination };

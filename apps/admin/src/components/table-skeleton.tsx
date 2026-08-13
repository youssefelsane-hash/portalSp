import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableRow, TableCell } from '@/components/ui/table';

// بديل عن نص "جاري التحميل…" الخام قبل أي جدول قايمة (docs/12) — بيحجز نفس شكل/مساحة الجدول
// الحقيقي الجاي بدل ومضة فراغ، فمفيش قفزة تخطيط (layout shift) لحظة وصول البيانات.
function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <Table>
      <TableBody>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <TableRow key={rowIndex}>
            {Array.from({ length: columns }).map((_, colIndex) => (
              <TableCell key={colIndex}>
                <Skeleton className="h-4 w-full" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export { TableSkeleton };

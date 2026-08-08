import * as React from 'react';

import { cn } from '@/lib/utils';

// select عنصر HTML خام بدل Radix Select — أسرع وكافي للحالات البسيطة هنا (اختيار فئة/نوع تسعير)،
// مفيش داعي لتعقيد Radix (portal, positioning) لقايمة قصيرة.
function SelectNative({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select-native"
      className={cn(
        'border-input flex h-9 w-full items-center rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        className,
      )}
      {...props}
    />
  );
}

export { SelectNative };

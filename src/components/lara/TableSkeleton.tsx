import { Skeleton } from '@/components/ui/skeleton';

interface TableSkeletonProps {
  rows?: number;
  cols?: number;
}

export function TableSkeleton({ rows = 8, cols = 6 }: TableSkeletonProps) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i} className="py-3 px-3">
                  <Skeleton className="h-3 w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r} className="border-b last:border-0">
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={c} className="py-3 px-3">
                    <Skeleton className="h-3 w-full max-w-[120px]" style={{ maxWidth: `${70 + ((c + r) % 4) * 20}px` }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

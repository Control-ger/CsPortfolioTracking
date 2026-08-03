import { Skeleton } from "@packages/shared";

export const Card = () => (
  <div className="w-[380px] rounded-xl border border-border p-4">
    <Skeleton className="h-5 w-40" />
    <Skeleton className="mt-2 h-4 w-56" />
    <Skeleton className="mt-4 h-8 w-32" />
  </div>
);

export const List = () => (
  <div className="grid w-[380px] gap-2">
    {[0, 1, 2].map((i) => (
      <div key={i} className="flex items-center gap-3 rounded-md border border-border p-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="flex-1"><Skeleton className="h-4 w-32" /><Skeleton className="mt-2 h-3 w-20" /></div>
      </div>
    ))}
  </div>
);

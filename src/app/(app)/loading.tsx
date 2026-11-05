import { Skeleton } from "@/components/ui/skeleton";

/** 画面の読み込み中（スケルトン） */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="読み込み中">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

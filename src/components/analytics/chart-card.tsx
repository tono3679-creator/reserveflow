import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type TableView = { columns: string[]; rows: (string | number)[][] };

/** グラフの枠：見出し・説明・グラフ・「表で見る」（色が見分けにくい場合や読み上げのための表） */
export function ChartCard({ title, description, children, table, className }: {
  title: string; description?: string; children: React.ReactNode; table?: TableView; className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex-col gap-1">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {children}
        {table && table.rows.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">表で見る</summary>
            <div className="mt-2 max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>{table.columns.map((c, i) => <th key={c} scope="col" className={i === 0 ? "px-2 py-1.5 text-left font-medium" : "px-2 py-1.5 text-right font-medium"}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      {r.map((v, j) => j === 0
                        ? <th key={j} scope="row" className="px-2 py-1 text-left font-normal">{v}</th>
                        : <td key={j} className="px-2 py-1 text-right tabular">{v}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

import { Card } from "./Card";

/** Temporary shell used by feature routes until the real feature lands. */
export function PagePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card>
        <p className="text-sm text-slate-600">{description}</p>
      </Card>
    </div>
  );
}

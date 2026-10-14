// Seitenkopf wie im Mockup: Überzeile, Titel, Untertitel, optional Aktionen rechts.
export default function PageHeader({ eyebrow, title, subtitle, children }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-sm font-semibold text-fb-accent-strong">{eyebrow}</p>}
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-base text-fb-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-end gap-3">{children}</div>}
    </header>
  );
}

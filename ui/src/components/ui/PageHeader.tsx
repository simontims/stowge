interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-5 gap-4">
      <div className="min-w-0">
        <h1 className="text-base font-semibold text-heading leading-tight">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-subtle mt-0.5">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex items-center gap-2 shrink-0">{action}</div>
      )}
    </div>
  );
}

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export function PlaceholderPage({
  title,
  description = "This page is coming soon.",
}: PlaceholderPageProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-base font-semibold text-neutral-100">{title}</h1>
        <p className="text-sm text-neutral-500 mt-0.5">{description}</p>
      </div>
      <div className="border border-dashed border-neutral-800 rounded-lg py-16 flex items-center justify-center text-sm text-neutral-700">
        No content yet
      </div>
    </div>
  );
}

import { PageHeader } from "../components/ui/PageHeader";

interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export function PlaceholderPage({
  title,
  description = "This page is coming soon.",
}: PlaceholderPageProps) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} description={description} />
      <div className="border border-dashed border-border rounded-lg py-16 flex items-center justify-center text-sm text-faint">
        No content yet
      </div>
    </div>
  );
}

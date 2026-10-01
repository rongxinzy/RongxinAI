import { Button } from '@shared/components/ui/button';
import { Search } from 'lucide-react';

export function SidebarSearchTrigger({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      variant="navigation"
      size="navigation"
      aria-label={label}
      aria-haspopup="dialog"
      onClick={onClick}
    >
      <Search aria-hidden="true" className="size-4" strokeWidth={1.75} />
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  );
}

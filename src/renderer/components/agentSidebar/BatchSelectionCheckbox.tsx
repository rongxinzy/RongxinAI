import { Checkbox } from '@shared/components/ui/checkbox';

interface BatchSelectionCheckboxProps {
  checked: boolean;
  onToggleSelection: () => void;
}

export const BatchSelectionCheckbox = ({
  checked,
  onToggleSelection,
}: BatchSelectionCheckboxProps) => (
  <span
    className="flex shrink-0"
    onClick={event => {
      // Base UI also dispatches a bubbling click from the hidden input beside its visual root.
      event.stopPropagation();
    }}
  >
    <Checkbox checked={checked} onCheckedChange={() => onToggleSelection()} className="size-3.5" />
  </span>
);

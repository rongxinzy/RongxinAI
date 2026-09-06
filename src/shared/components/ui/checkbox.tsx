import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { cn } from '@shared/lib/utils';
import { CheckIcon } from 'lucide-react';

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'theme-check peer relative flex shrink-0 items-center justify-center after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="theme-check-indicator grid place-content-center"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };

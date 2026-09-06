import { Separator as SeparatorPrimitive } from '@base-ui/react/separator';
import { cn } from '@shared/lib/utils';

function Separator({ className, orientation = 'horizontal', ...props }: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        'theme-separator shrink-0 data-[orientation=horizontal]:w-full data-[orientation=vertical]:self-stretch',
        className,
      )}
      {...props}
    />
  );
}

export { Separator };

import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from '@shared/lib/utils';

function Slider({ className, ...props }: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'group/slider flex w-full touch-none items-center data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex h-5 w-full items-center">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="absolute h-full bg-primary"
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          className="size-4 rounded-full border-2 border-primary bg-background shadow-sm outline-none transition-transform duration-100 group-hover/slider:scale-105 focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };

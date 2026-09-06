import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from '@shared/lib/utils';

function Slider({ className, ...props }: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        'theme-range group group/slider flex w-full touch-none items-center',
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Control className="theme-range-control relative flex w-full items-center">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="theme-range-track relative w-full overflow-hidden"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="theme-range-fill absolute h-full"
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          className="theme-range-thumb"
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };

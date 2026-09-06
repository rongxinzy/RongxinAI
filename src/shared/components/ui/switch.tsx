import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from '@shared/lib/utils';
import { animate, motion, useMotionValue, useReducedMotion, type Transition } from 'motion/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from 'react';

type SwitchSize = 'sm' | 'default';

const SwitchMode = {
  WorkChat: 'work-chat',
} as const;

interface SwitchGeometry {
  trackWidth: number;
  trackHeight: number;
  thumbSize: number;
  thumbOffset: number;
  borderWidth: number;
  hoverExtend: number;
  pressExtend: number;
  pressShrink: number;
  motionMs: number;
}

const SWITCH_GEOMETRY: Record<SwitchSize, SwitchGeometry> = {
  default: {
    trackWidth: 34,
    trackHeight: 20,
    thumbSize: 16,
    thumbOffset: 1,
    borderWidth: 1,
    hoverExtend: 2,
    pressExtend: 4,
    pressShrink: 4,
    motionMs: 160,
  },
  sm: {
    trackWidth: 24,
    trackHeight: 14,
    thumbSize: 12,
    thumbOffset: 1,
    borderWidth: 1,
    hoverExtend: 2,
    pressExtend: 4,
    pressShrink: 4,
    motionMs: 160,
  },
};

const DRAG_DEAD_ZONE = 2;

type SwitchProps = SwitchPrimitive.Root.Props & {
  'data-mode'?: (typeof SwitchMode)[keyof typeof SwitchMode];
  size?: SwitchSize;
  thumbTransition?: Transition;
};

function Switch({
  checked,
  className,
  'data-mode': dataMode,
  defaultChecked,
  disabled = false,
  onCheckedChange,
  onClick,
  onPointerCancel,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  onPointerMove,
  onPointerUp,
  readOnly = false,
  ref,
  size = 'default',
  thumbTransition,
  ...props
}: SwitchProps) {
  const isWorkChat = dataMode === SwitchMode.WorkChat;
  const rootRef = useRef<HTMLButtonElement>(null);
  useImperativeHandle(ref, () => rootRef.current!, []);
  const [geometry, setGeometry] = useState(SWITCH_GEOMETRY[size]);
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element || isWorkChat) return;
    const measure = () => {
      const css = getComputedStyle(element);
      const fallback = SWITCH_GEOMETRY[size];
      const number = (name: string, fallbackValue: number) => {
        const value = parseFloat(css.getPropertyValue(`--zy-style-switch-${name}`));
        return Number.isFinite(value) && value >= 0 ? value : fallbackValue;
      };
      const next: SwitchGeometry = {
        trackWidth: element.offsetWidth || fallback.trackWidth,
        trackHeight: element.offsetHeight || fallback.trackHeight,
        borderWidth: parseFloat(css.borderLeftWidth) || 0,
        thumbSize: number(size === 'sm' ? 'thumb-size-sm' : 'thumb-size', fallback.thumbSize),
        thumbOffset: number('thumb-offset', fallback.thumbOffset),
        hoverExtend: number('hover-extend', fallback.hoverExtend),
        pressExtend: number('press-extend', fallback.pressExtend),
        pressShrink: number('press-shrink', fallback.pressShrink),
        motionMs: number('motion-ms', fallback.motionMs),
      };
      setGeometry(previous =>
        Object.keys(next).every(
          key => previous[key as keyof SwitchGeometry] === next[key as keyof SwitchGeometry],
        )
          ? previous
          : next,
      );
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    const theme = new MutationObserver(measure);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class', 'style'],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  }, [isWorkChat, size]);
  const trackContentWidth = geometry.trackWidth - geometry.borderWidth * 2;
  const prefersReducedMotion = useReducedMotion();
  const transition = useMemo<Transition>(
    () =>
      prefersReducedMotion
        ? { duration: 0 }
        : (thumbTransition ?? { type: 'spring', duration: geometry.motionMs / 1000, bounce: 0 }),
    [prefersReducedMotion, thumbTransition, geometry.motionMs],
  );
  const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked ?? false);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const currentChecked = checked ?? uncontrolledChecked;
  const currentCheckedRef = useRef(currentChecked);
  const hasMounted = useRef(false);
  const dragging = useRef(false);
  const didDrag = useRef(false);
  const dispatchingDragClick = useRef(false);
  const pointerStart = useRef<{ clientX: number; originX: number } | null>(null);
  const motionX = useMotionValue(
    currentChecked
      ? trackContentWidth - geometry.thumbOffset - geometry.thumbSize
      : geometry.thumbOffset,
  );

  currentCheckedRef.current = currentChecked;

  useEffect(() => {
    hasMounted.current = true;
  }, []);

  const thumbWidth = prefersReducedMotion
    ? geometry.thumbSize
    : pressed
      ? geometry.thumbSize + geometry.pressExtend
      : hovered
        ? geometry.thumbSize + geometry.hoverExtend
        : geometry.thumbSize;
  const thumbHeight =
    prefersReducedMotion || !pressed
      ? geometry.thumbSize
      : geometry.thumbSize - geometry.pressShrink;
  const thumbY =
    (geometry.trackHeight - geometry.borderWidth * 2 - geometry.thumbSize) / 2 +
    (geometry.thumbSize - thumbHeight) / 2;
  const thumbX = currentChecked
    ? trackContentWidth - geometry.thumbOffset - thumbWidth
    : geometry.thumbOffset;

  useEffect(() => {
    if (isWorkChat || dragging.current) return;
    if (!hasMounted.current || prefersReducedMotion) {
      motionX.set(thumbX);
      return;
    }
    const controls = animate(motionX, thumbX, transition);
    return () => controls.stop();
  }, [isWorkChat, motionX, prefersReducedMotion, thumbX, transition]);

  const handleCheckedChange = useCallback<
    NonNullable<SwitchPrimitive.Root.Props['onCheckedChange']>
  >(
    (nextChecked, eventDetails) => {
      onCheckedChange?.(nextChecked, eventDetails);
      if (checked === undefined && !eventDetails.isCanceled) {
        setUncontrolledChecked(nextChecked);
      }
    },
    [checked, onCheckedChange],
  );

  const resetPointerInteraction = useCallback(() => {
    setPressed(false);
    dragging.current = false;
    pointerStart.current = null;
  }, []);

  const handlePointerDown: NonNullable<SwitchPrimitive.Root.Props['onPointerDown']> = useCallback(
    event => {
      onPointerDown?.(event);
      if (event.defaultPrevented || disabled || readOnly) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      setPressed(true);
      dragging.current = false;
      didDrag.current = false;
      pointerStart.current = {
        clientX: event.clientX,
        originX: motionX.get(),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [disabled, motionX, onPointerDown, readOnly],
  );

  const handlePointerMove: NonNullable<SwitchPrimitive.Root.Props['onPointerMove']> = useCallback(
    event => {
      onPointerMove?.(event);
      if (event.defaultPrevented || !pointerStart.current) return;

      const delta = event.clientX - pointerStart.current.clientX;
      if (!dragging.current) {
        if (Math.abs(delta) < DRAG_DEAD_ZONE) return;
        dragging.current = true;
        // Pointer movement owns the position once dragging starts. Stop an
        // in-flight toggle/press animation before it can overwrite motionX.
        motionX.stop();
      }

      const dragMin = geometry.thumbOffset;
      const pressedThumbWidth = geometry.thumbSize + geometry.pressExtend;
      const dragMax = trackContentWidth - geometry.thumbOffset - pressedThumbWidth;
      const rawX = pointerStart.current.originX + delta;
      motionX.set(Math.max(dragMin, Math.min(dragMax, rawX)));
    },
    [geometry, motionX, onPointerMove, trackContentWidth],
  );

  const handlePointerUp: NonNullable<SwitchPrimitive.Root.Props['onPointerUp']> = useCallback(
    event => {
      onPointerUp?.(event);
      if (!pointerStart.current) return;

      if (dragging.current) {
        didDrag.current = true;
        const dragMin = geometry.thumbOffset;
        const pressedThumbWidth = geometry.thumbSize + geometry.pressExtend;
        const dragMax = trackContentWidth - geometry.thumbOffset - pressedThumbWidth;
        const shouldBeChecked = motionX.get() > (dragMin + dragMax) / 2;

        if (shouldBeChecked !== currentCheckedRef.current) {
          dispatchingDragClick.current = true;
          event.currentTarget.click();
          dispatchingDragClick.current = false;
        } else {
          const snapTarget = shouldBeChecked
            ? trackContentWidth - geometry.thumbOffset - geometry.thumbSize
            : geometry.thumbOffset;
          animate(motionX, snapTarget, transition);
        }

        requestAnimationFrame(() => {
          didDrag.current = false;
        });
      }

      resetPointerInteraction();
    },
    [geometry, motionX, onPointerUp, resetPointerInteraction, trackContentWidth, transition],
  );

  const handlePointerCancel: NonNullable<SwitchPrimitive.Root.Props['onPointerCancel']> =
    useCallback(
      event => {
        onPointerCancel?.(event);
        if (!pointerStart.current) return;

        const snapTarget = currentCheckedRef.current
          ? trackContentWidth - geometry.thumbOffset - geometry.thumbSize
          : geometry.thumbOffset;
        animate(motionX, snapTarget, transition);
        resetPointerInteraction();
      },
      [geometry, motionX, onPointerCancel, resetPointerInteraction, trackContentWidth, transition],
    );

  const handleClick: NonNullable<SwitchPrimitive.Root.Props['onClick']> = useCallback(
    event => {
      if (didDrag.current && !dispatchingDragClick.current) {
        event.preventBaseUIHandler();
        return;
      }
      onClick?.(event);
    },
    [onClick],
  );

  return (
    <SwitchPrimitive.Root
      ref={rootRef}
      data-slot="switch"
      data-size={size}
      data-mode={dataMode}
      data-fluid-switch={isWorkChat ? undefined : ''}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      readOnly={readOnly}
      onCheckedChange={handleCheckedChange}
      onClick={isWorkChat ? onClick : handleClick}
      onPointerCancel={isWorkChat ? onPointerCancel : handlePointerCancel}
      onPointerDown={isWorkChat ? onPointerDown : handlePointerDown}
      onPointerEnter={
        isWorkChat
          ? onPointerEnter
          : event => {
              onPointerEnter?.(event);
              if (!event.defaultPrevented && event.pointerType === 'mouse') setHovered(true);
            }
      }
      onPointerLeave={
        isWorkChat
          ? onPointerLeave
          : event => {
              onPointerLeave?.(event);
              setHovered(false);
            }
      }
      onPointerMove={isWorkChat ? onPointerMove : handlePointerMove}
      onPointerUp={isWorkChat ? onPointerUp : handlePointerUp}
      className={cn(
        'theme-switch peer group/switch relative inline-flex shrink-0 cursor-pointer touch-none items-center after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:pointer-events-none data-disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    >
      {isWorkChat ? (
        <SwitchPrimitive.Thumb data-slot="switch-thumb" className="pointer-events-none block" />
      ) : (
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          render={thumbProps => {
            const {
              style: baseStyle,
              onDrag: _onDrag,
              onDragStart: _onDragStart,
              onDragEnd: _onDragEnd,
              onAnimationStart: _onAnimationStart,
              onAnimationEnd: _onAnimationEnd,
              onAnimationIteration: _onAnimationIteration,
              ...rest
            } = thumbProps as HTMLAttributes<HTMLSpanElement>;

            return (
              <motion.span
                {...rest}
                className="theme-switch-thumb pointer-events-none absolute top-0 left-0 block"
                initial={false}
                style={{
                  ...(baseStyle as CSSProperties | undefined),
                  x: motionX,
                }}
                animate={{
                  y: thumbY,
                  width: thumbWidth,
                  height: thumbHeight,
                }}
                transition={hasMounted.current ? transition : { duration: 0 }}
              />
            );
          }}
        />
      )}
    </SwitchPrimitive.Root>
  );
}

export { Switch };
export type { SwitchProps };

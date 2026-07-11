"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, input, textarea, select, a, [data-carousel-ignore]"));
}

type MasteryCardCarouselProps<T> = {
  activeIndex: number;
  getKey: (item: T) => number | string;
  items: T[];
  onActiveIndexChange: (index: number) => void;
  renderSlide: (options: {
    canNext: boolean;
    canPrevious: boolean;
    index: number;
    item: T;
    next: () => void;
    previous: () => void;
    total: number;
  }) => ReactNode;
};

export default function MasteryCardCarousel<T>({
  activeIndex,
  getKey,
  items,
  onActiveIndexChange,
  renderSlide,
}: MasteryCardCarouselProps<T>) {
  const safeActiveIndex = items.length > 0 ? Math.max(0, Math.min(activeIndex, items.length - 1)) : 0;
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const hasPositionedRef = useRef(false);
  const gestureRef = useRef({
    active: false,
    dragged: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
  });
  const wheelLockRef = useRef(0);

  const positionTrack = useCallback((index: number, dragOffset = 0, animate = true) => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    viewport.scrollLeft = 0;
    track.style.transition = animate ? "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
    track.style.transform = `translate3d(calc(${-index * 100}% + ${dragOffset}px), 0, 0)`;
  }, []);

  useLayoutEffect(() => {
    if (items.length === 0) return;
    positionTrack(safeActiveIndex, 0, hasPositionedRef.current);
    hasPositionedRef.current = true;
  }, [items.length, positionTrack, safeActiveIndex]);

  const moveBy = useCallback((delta: number) => {
    if (items.length === 0) return;
    const nextIndex = Math.max(0, Math.min(items.length - 1, safeActiveIndex + delta));
    if (nextIndex !== safeActiveIndex) onActiveIndexChange(nextIndex);
    else positionTrack(safeActiveIndex);
  }, [items.length, onActiveIndexChange, positionTrack, safeActiveIndex]);

  const previous = useCallback(() => moveBy(-1), [moveBy]);
  const next = useCallback(() => moveBy(1), [moveBy]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target) || event.button !== 0) return;
    gestureRef.current = {
      active: true,
      dragged: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.dragged) {
      if (Math.abs(deltaY) > Math.abs(deltaX)) return;
      if (Math.abs(deltaX) < 6) return;
      gesture.dragged = true;
    }
    event.preventDefault();
    const atStart = safeActiveIndex === 0 && deltaX > 0;
    const atEnd = safeActiveIndex === items.length - 1 && deltaX < 0;
    positionTrack(safeActiveIndex, atStart || atEnd ? deltaX * 0.18 : deltaX, false);
  };

  const finishPointerGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const threshold = Math.min(96, event.currentTarget.clientWidth * 0.14);
    gesture.active = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (gesture.dragged && Math.abs(deltaX) >= threshold) {
      moveBy(deltaX < 0 ? 1 : -1);
    } else {
      positionTrack(safeActiveIndex);
    }
  };

  const cancelPointerGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture.active || gesture.pointerId !== event.pointerId) return;
    gesture.active = false;
    positionTrack(safeActiveIndex);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target)) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      previous();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    }
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      if (isInteractiveTarget(event.target)) return;
      const horizontalSwipe = Math.abs(event.deltaX) > 24 && Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.2;
      if (!horizontalSwipe) return;
      event.preventDefault();

      const now = Date.now();
      if (now - wheelLockRef.current < 520) return;
      wheelLockRef.current = now;
      if (event.deltaX > 0) next();
      else previous();
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [next, previous]);

  return (
    <div
      aria-label="Card carousel"
      className="min-h-0 w-full overflow-hidden outline-none"
      onKeyDown={handleKeyDown}
      onPointerCancel={cancelPointerGesture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerGesture}
      ref={viewportRef}
      role="region"
      style={{ touchAction: "pan-y" }}
      tabIndex={0}
    >
      <div
        className="flex min-h-0 w-full will-change-transform"
        ref={trackRef}
      >
        {items.map((item, index) => (
          <div
            className="w-full min-w-0 shrink-0 grow-0"
            key={getKey(item)}
          >
            {renderSlide({
              canNext: index < items.length - 1,
              canPrevious: index > 0,
              index,
              item,
              next,
              previous,
              total: items.length,
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

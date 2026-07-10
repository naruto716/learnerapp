"use client";

import { useEffect, useMemo, useRef, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import type { EmblaCarouselType, EmblaOptionsType } from "embla-carousel";
import useEmblaCarousel from "embla-carousel-react";

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
  slideBasis?: string;
};

export default function MasteryCardCarousel<T>({
  activeIndex,
  getKey,
  items,
  onActiveIndexChange,
  renderSlide,
  slideBasis = "min(100%, 820px)",
}: MasteryCardCarouselProps<T>) {
  const wheelLockRef = useRef(0);
  const options = useMemo<EmblaOptionsType>(
    () => ({
      align: "center",
      containScroll: "trimSnaps",
      dragFree: false,
      dragThreshold: 18,
      duration: 28,
      loop: false,
      skipSnaps: false,
      watchDrag: (_api, event) => !isInteractiveTarget(event.target),
    }),
    [],
  );
  const [viewportRef, api] = useEmblaCarousel(options);
  const safeActiveIndex = items.length > 0 ? Math.min(activeIndex, items.length - 1) : 0;

  useEffect(() => {
    if (!api) return;

    const syncIndex = (carousel: EmblaCarouselType) => {
      const selectedIndex = carousel.selectedScrollSnap();
      const delta = selectedIndex - safeActiveIndex;
      if (Math.abs(delta) > 1) {
        carousel.scrollTo(safeActiveIndex + Math.sign(delta));
        return;
      }
      onActiveIndexChange(selectedIndex);
    };
    const handleSelect = () => syncIndex(api);
    api.on("select", handleSelect);
    api.on("reInit", handleSelect);
    return () => {
      api.off("select", handleSelect);
      api.off("reInit", handleSelect);
    };
  }, [api, onActiveIndexChange, safeActiveIndex]);

  useEffect(() => {
    if (!api || items.length === 0) return;
    if (api.selectedScrollSnap() !== safeActiveIndex) api.scrollTo(safeActiveIndex);
  }, [api, items.length, safeActiveIndex]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!api || isInteractiveTarget(event.target)) return;
    const horizontalSwipe = Math.abs(event.deltaX) > 24 && Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.2;
    if (!horizontalSwipe) return;
    event.preventDefault();

    const now = Date.now();
    if (now - wheelLockRef.current < 520) return;
    wheelLockRef.current = now;
    if (event.deltaX > 0) api.scrollNext();
    else api.scrollPrev();
  };

  return (
    <div className="min-h-0 w-full overflow-hidden" onWheel={handleWheel} ref={viewportRef}>
      <div className="flex min-h-0 touch-pan-y gap-4">
        {items.map((item, index) => {
          const active = index === safeActiveIndex;
          return (
            <div
              aria-hidden={!active}
              className={`min-w-0 shrink-0 grow-0 transition-[opacity,transform] duration-200 ${
                active ? "scale-100 opacity-100" : "pointer-events-none scale-[0.96] opacity-45"
              }`}
              key={getKey(item)}
              style={{ flexBasis: slideBasis }}
            >
              {renderSlide({
                canNext: index < items.length - 1,
                canPrevious: index > 0,
                index,
                item,
                next: () => api?.scrollNext(),
                previous: () => api?.scrollPrev(),
                total: items.length,
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

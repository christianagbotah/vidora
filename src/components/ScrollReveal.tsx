"use client";

import React, { useRef, useEffect, useState, useCallback, useSyncExternalStore } from "react";

interface ScrollRevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  direction?: "up" | "down" | "left" | "right";
  threshold?: number;
}

const translateMap: Record<NonNullable<ScrollRevealProps["direction"]>, string> = {
  up: "translate-y-6",
  down: "-translate-y-6",
  left: "translate-x-6",
  right: "-translate-x-6",
};

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

export default function ScrollReveal({
  children,
  className = "",
  delay = 0,
  direction = "up",
  threshold = 0.1,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const isVisibleRef = useRef(false);

  const handleIntersect = useCallback(
    (entry: IntersectionObserverEntry) => {
      if (entry.isIntersecting && !isVisibleRef.current) {
        isVisibleRef.current = true;
        if (delay > 0) {
          const id = setTimeout(() => setIsVisible(true), delay);
          return () => clearTimeout(id);
        }
        setIsVisible(true);
      }
    },
    [delay]
  );

  useEffect(() => {
    if (prefersReducedMotion || isVisibleRef.current) return;

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const cleanup = handleIntersect(entries[0]);
        if (cleanup) {
          observer.disconnect();
        }
      },
      { threshold }
    );

    observer.observe(el);

    return () => observer.disconnect();
  }, [delay, threshold, prefersReducedMotion, handleIntersect]);

  // If user prefers reduced motion, render without animation wrapper
  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        isVisible
          ? "opacity-100 translate-x-0 translate-y-0"
          : `opacity-0 ${translateMap[direction]}`
      } ${className}`}
    >
      {children}
    </div>
  );
}

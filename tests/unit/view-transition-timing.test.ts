import { describe, expect, test } from "bun:test";
import {
  resolveViewTransitionTiming,
  VIEW_TRANSITION_MAX_MS,
  VIEW_TRANSITION_MIN_MS,
} from "../../src/lib/view-transition-timing";

describe("view transition timing", () => {
  test("starts the real hard cap from the loading event", () => {
    expect(resolveViewTransitionTiming(1_000, 1_000)).toEqual({
      elapsedMs: 0,
      readyDelayMs: VIEW_TRANSITION_MIN_MS,
      hardCapDelayMs: VIEW_TRANSITION_MAX_MS,
    });
  });

  test("preserves the minimum display when ready arrives early", () => {
    expect(resolveViewTransitionTiming(1_000, 1_250)).toEqual({
      elapsedMs: 250,
      readyDelayMs: 550,
      hardCapDelayMs: 3_750,
    });
  });

  test("allows immediate completion after the minimum without resetting the hard cap", () => {
    expect(resolveViewTransitionTiming(1_000, 2_200)).toEqual({
      elapsedMs: 1_200,
      readyDelayMs: 0,
      hardCapDelayMs: 2_800,
    });
  });

  test("clamps overdue and backwards clocks safely", () => {
    expect(resolveViewTransitionTiming(1_000, 6_000)).toEqual({
      elapsedMs: 5_000,
      readyDelayMs: 0,
      hardCapDelayMs: 0,
    });
    expect(resolveViewTransitionTiming(1_000, 900)).toEqual({
      elapsedMs: 0,
      readyDelayMs: VIEW_TRANSITION_MIN_MS,
      hardCapDelayMs: VIEW_TRANSITION_MAX_MS,
    });
  });

  test("never permits a configured hard cap below the minimum", () => {
    expect(resolveViewTransitionTiming(0, 0, 1_500, 500)).toEqual({
      elapsedMs: 0,
      readyDelayMs: 1_500,
      hardCapDelayMs: 1_500,
    });
  });
});

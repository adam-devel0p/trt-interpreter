'use client';

import { MotionConfig, useReducedMotion as useFramerReducedMotion } from 'framer-motion';
import * as React from 'react';

/**
 * Global motion policy. `reducedMotion="user"` makes every framer-motion animation in the tree
 * (including the future shuffle/reveal) collapse to an instant state change when the OS asks.
 * Tokens: 150–250ms ease-out.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
      {children}
    </MotionConfig>
  );
}

export const useReducedMotion = useFramerReducedMotion;

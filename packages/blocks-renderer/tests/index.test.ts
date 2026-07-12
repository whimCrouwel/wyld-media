import { describe, it, expect } from 'vitest';
import { BLOCKS_RENDERER_READY } from '../src/index';

describe('@wild-media/blocks-renderer scaffold', () => {
  it('exports a truthy readiness flag', () => {
    expect(BLOCKS_RENDERER_READY).toBe(true);
  });
});

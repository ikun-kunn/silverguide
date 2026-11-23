// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('高对比度焦点样式', () => {
  it('设置专用高对比焦点色、明显轮廓和强制色模式回退', () => {
    const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/html\[data-high-contrast='true'\]\s*\{[^}]*--sg-focus:\s*#000000/);
    expect(css).toMatch(/html\[data-high-contrast='true'\] :focus-visible\s*\{[^}]*outline:\s*4px solid var\(--sg-focus\)/);
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*outline-color:\s*Highlight/);
  });
});

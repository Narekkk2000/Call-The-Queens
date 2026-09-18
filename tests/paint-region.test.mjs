import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/spray/paintRegion.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { paintRegion } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('Retina redraws use integer backing pixels and fully enclose the changed paint', () => {
  const bounds = { x: 137, y: 89, right: 419, bottom: 277 };
  const region = paintRegion(bounds, 1001, 621, 1602, 994);
  assert.ok(Object.values(region).every(Number.isInteger));
  assert.ok(region.x <= bounds.x * 1602 / 1001);
  assert.ok(region.y <= bounds.y * 994 / 621);
  assert.ok(region.x + region.width >= bounds.right * 1602 / 1001);
  assert.ok(region.y + region.height >= bounds.bottom * 994 / 621);
});

test('whole-wall refresh exactly covers odd-sized backing canvases', () => {
  assert.deepEqual(paintRegion({ x: 0, y: 0, right: 1001, bottom: 621 }, 1001, 621, 1602, 994),
    { x: 0, y: 0, width: 1602, height: 994 });
});

test('edge strokes stay inside the canvas', () => {
  assert.deepEqual(paintRegion({ x: -10, y: -10, right: 1050, bottom: 650 }, 1001, 621, 1602, 994),
    { x: 0, y: 0, width: 1602, height: 994 });
});

test('standard-density redraws retain their original bounds', () => {
  assert.deepEqual(paintRegion({ x: 23, y: 51, right: 87, bottom: 139 }, 1001, 621, 1001, 621),
    { x: 23, y: 51, width: 64, height: 88 });
});

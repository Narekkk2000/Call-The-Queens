import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

// Use the project's existing compiler, with no browser or new test dependency.
const source = readFileSync(new URL('../src/spray/StrokeSampler.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { StrokeSampler } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const point = (x, y = 0, pressure = 1) => ({ x, y, pressure });

function stroke(points) {
  const result = [];
  const sampler = new StrokeSampler(10, p => result.push(p));
  points.forEach(p => sampler.add(p));
  return result;
}

test('a fast drag paints every interval, including its start and endpoint', () => {
  assert.deepEqual(stroke([point(0), point(100)]).map(p => p.x), [0,10,20,30,40,50,60,70,80,90,100]);
});

test('60 Hz, 120 Hz, and batched input produce the same straight stroke', () => {
  const paths = [1, 60, 120, 240].map(count => stroke(Array.from({ length: count + 1 }, (_, i) => point(i * 1200 / count))));
  for (const result of paths) {
    assert.equal(result.length, paths[0].length);
    result.forEach((p, i) => assert.ok(Math.abs(p.x - paths[0][i].x) < 1e-9));
  }
});

test('coalesced corners follow the input path instead of cutting across it', () => {
  const result = stroke([point(0), point(20), point(20, 20), point(0, 20)]);
  assert.deepEqual(result.map(p => [p.x, p.y]), [[0,0],[10,0],[20,0],[20,10],[20,20],[10,20],[0,20]]);
});

test('subpixel movements accumulate instead of leaving holes', () => {
  const result = stroke(Array.from({ length: 201 }, (_, i) => point(i / 10)));
  assert.equal(result.length, 3);
  assert.ok(Math.abs(result[2].x - 20) < 1e-9);
});

test('separate gestures never get joined by a painted line', () => {
  const result = [];
  const sampler = new StrokeSampler(10, p => result.push(p));
  sampler.add(point(10));
  sampler.end();
  assert.equal(sampler.active, false);
  sampler.add(point(500));
  assert.deepEqual(result.map(p => p.x), [10, 500]);
});

test('stylus pressure is interpolated through fast movements', () => {
  const result = stroke([point(0, 0, 0.2), point(20, 0, 1)]);
  assert.ok(Math.abs(result[1].pressure - 0.6) < 1e-9);
  assert.equal(result[2].pressure, 1);
});

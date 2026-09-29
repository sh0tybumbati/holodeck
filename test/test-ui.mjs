#!/usr/bin/env node
// Unit tests for the pure helpers in js/ui.js:  node test/test-ui.mjs
import assert from 'node:assert/strict';
import { describeTransform, describeMeasurement } from '../js/ui.js';

let failed = 0;
function test(name, fn) { try { fn(); console.log('PASS', name); } catch (e) { failed++; console.log('FAIL', name, '\n  ', e.message); } }
const snap = { enabled: true, label: '1.0 mm' };

test('translate readout is in mm and names the snap', () => {
    assert.equal(describeTransform('translate', { position: [1.25, 0, -0.4] }, snap), 'X 12.5  Y 0.0  Z -4.0 mm  · snap 1.0 mm');
});
test('negative zero is not printed', () => {
    assert.ok(!describeTransform('translate', { position: [-0.0001, 0, 0] }, snap).includes('-0.0'));
});
test('rotate and scale readouts', () => {
    assert.equal(describeTransform('rotate', { rotationDeg: [0, 45, 90] }, snap), 'X 0.0°  Y 45.0°  Z 90.0°  · snap 5°');
    assert.equal(describeTransform('scale', { size: [2, 3, 4] }, { enabled: false }), '20.0 × 30.0 × 40.0 mm  · snap off');
});
test('measurement is a 3-4-5 triangle in mm', () => {
    const m = describeMeasurement([0, 0, 0], [3, 0, 4]);
    assert.equal(m.text, '50.00 mm'); assert.equal(m.detail, 'Δx 30.00  Δy 0.00  Δz 40.00 mm');
});
process.exit(failed ? 1 : 0);

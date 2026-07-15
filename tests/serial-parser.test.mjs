import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBestSerial, extractSerialCandidates, sanitizeSerial } from '../serial-parser.js';

test('extracts serial from Lenovo bottom label text', () => {
  const text = `Model Name: Lenovo 300e Yoga Chromebook Gen 4\nMfg Date: 2025/03/25\nS/N: YX0EEL9T MTM:82W2002KUS\nMO: YXN0B5332500R`;
  assert.equal(extractBestSerial(text), 'YX0EEL9T');
});

test('extracts serial from compact diagnostics line', () => {
  const text = `ZT ADID:1S82W2002KUSYX0EEL9T SN:YX0EEL9T`;
  assert.equal(extractBestSerial(text), 'YX0EEL9T');
});

test('repairs common OCR substitutions from a physical Lenovo label', () => {
  const text = `Lenovo 300e Yoga Chromebook Gen 4\nSANSYXOEEL9OT MTM:82W2002KUS`;
  assert.equal(extractBestSerial(text), 'YX0EEL9T');
});

test('repairs common OCR substitutions from a diagnostics screen', () => {
  const text = `ZTE ADID:1S82W2002KUSYXOEELST SN YXOEELST`;
  assert.equal(extractBestSerial(text), 'YX0EEL9T');
});

test('ranks labeled serial above model number', () => {
  const text = `MODEL 82W2002KUS INPUT 20V 325A SERIAL NUMBER AB12CD34`;
  assert.equal(extractSerialCandidates(text)[0].value, 'AB12CD34');
});

test('sanitizes manual serial entry', () => {
  assert.equal(sanitizeSerial(' s/n: yx0-eel9t '), 'YX0EEL9T');
});

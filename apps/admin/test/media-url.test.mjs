import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMediaUrl } from '../src/lib/media-url.ts';

test('keeps S3 and absolute local-storage URLs unchanged', () => {
  assert.equal(resolveMediaUrl('https://storage.example/orders/photo.jpg?signature=abc'), 'https://storage.example/orders/photo.jpg?signature=abc');
  assert.equal(resolveMediaUrl('http://localhost:3000/uploads/orders/photo.jpg'), 'http://localhost:3000/uploads/orders/photo.jpg');
});

test('resolves legacy relative media paths against the API origin', () => {
  assert.equal(resolveMediaUrl('/uploads/orders/photo.jpg'), 'http://localhost:3000/uploads/orders/photo.jpg');
  assert.equal(resolveMediaUrl('uploads/orders/photo.jpg'), 'http://localhost:3000/uploads/orders/photo.jpg');
});

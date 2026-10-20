const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { LANGUAGES, resolveLocale, strings, translate, createTranslator } = require('../src/i18n');
const en = require('../src/locales/en');
const ko = require('../src/locales/ko');

test('명시적으로 고른 언어가 시스템 언어보다 우선한다', () => {
  assert.equal(resolveLocale('ko', 'en-US'), 'ko');
  assert.equal(resolveLocale('en', 'ko-KR'), 'en');
});

test('auto는 시스템 언어를 따르고, 지원하지 않거나 감지하지 못하면 영어', () => {
  assert.equal(resolveLocale('auto', 'ko'), 'ko');
  assert.equal(resolveLocale('auto', 'ko-KR'), 'ko');
  assert.equal(resolveLocale('auto', 'KO_kr'), 'ko');
  assert.equal(resolveLocale('auto', 'en-US'), 'en');
  assert.equal(resolveLocale('auto', 'ja-JP'), 'en');
  for (const bad of ['', undefined, null, 42, {}]) assert.equal(resolveLocale('auto', bad), 'en', String(bad));
});

test('알 수 없는 설정값도 auto처럼 처리한다', () => {
  assert.equal(resolveLocale('xx', 'ko'), 'ko');
  assert.equal(resolveLocale(undefined, 'fr'), 'en');
  assert.equal(resolveLocale('__proto__', 'ko'), 'ko');
});

test('LANGUAGES는 auto와 지원 언어를 모두 포함한다', () => {
  assert.deepEqual(LANGUAGES, ['auto', 'en', 'ko']);
});

test('모든 언어가 영어와 같은 키를 가진다', () => {
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort());
});

test('모든 언어의 {자리표시자}가 영어와 같다', () => {
  const holes = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  for (const k of Object.keys(en)) assert.equal(holes(ko[k]), holes(en[k]), k);
});

test('번역: 자리표시자를 채우고, 없는 키는 키 그대로 돌려준다', () => {
  const t = createTranslator('ko');
  assert.equal(t('update.currentVersion', { version: '1.2.3' }), '현재 버전 v1.2.3');
  assert.equal(createTranslator('en')('update.downloading', { version: '1.0.0', percent: 5 }), 'Downloading v1.0.0… 5%');
  assert.equal(t('net::ERR_INTERNET_DISCONNECTED'), 'net::ERR_INTERNET_DISCONNECTED');
  assert.equal(translate(strings('en'), 'toString'), 'toString');
});

test('지원하지 않는 locale 사전은 영어로 채워진다', () => {
  assert.deepEqual(strings('zz'), en);
});

test('main/updater/settings가 쓰는 오류 키는 모두 사전에 있다', () => {
  const src = path.join(__dirname, '..', 'src');
  const used = new Set();
  for (const f of ['main.js', 'settings.js', 'updater.js', 'preload.js']) {
    const text = fs.readFileSync(path.join(src, f), 'utf8');
    for (const m of text.matchAll(/'((?:error|update|shortcut|discord|language|bl|app)\.[A-Za-z]+)'/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(k in en, k);
});

// 앱 문구 번역. 언어를 추가하려면 src/locales/<코드>.js를 만들고 DICTS에 넣는다.
const en = require('./locales/en');
const ko = require('./locales/ko');

const FALLBACK = 'en';
const DICTS = Object.freeze({ en, ko });
const LANGUAGES = Object.freeze(['auto', ...Object.keys(DICTS)]);

// setting: 'auto' | 지원 언어 코드. 'auto'면 시스템 언어를 따르고, 감지하지 못하거나 지원하지 않으면 영어다.
function resolveLocale(setting, systemLocale) {
  if (Object.hasOwn(DICTS, setting)) return setting;
  const base = typeof systemLocale === 'string' ? systemLocale.toLowerCase().split(/[-_]/)[0] : '';
  return Object.hasOwn(DICTS, base) ? base : FALLBACK;
}

// 해당 언어에 없는 키는 영어로 채운 전체 문구 사전. 샌드박스된 preload로 넘겨주는 용도다.
function strings(locale) {
  return { ...DICTS[FALLBACK], ...(DICTS[locale] || {}) };
}

function format(text, params) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? String(params[k]) : m));
}

// 사전에 없는 키(예: electron이 준 원문 오류 메시지)는 그대로 돌려준다.
function translate(dict, key, params) {
  return Object.hasOwn(dict, key) ? format(dict[key], params) : key;
}

function createTranslator(locale) {
  const dict = strings(locale);
  return (key, params) => translate(dict, key, params);
}

module.exports = { LANGUAGES, resolveLocale, strings, translate, createTranslator };

// Shared compatibility shim for chrome.* APIs missing in Electron's extension support.
// Works as a classic script (content scripts / extension pages) and as an ES module import.
(function (g) {
  if (g.__electronShimApplied) return;

  var chrome = (g.chrome = g.chrome || {});

  function makeEvent() {
    var ls = [];
    return {
      addListener: function (cb) { if (typeof cb === 'function' && ls.indexOf(cb) < 0) ls.push(cb); },
      removeListener: function (cb) { var i = ls.indexOf(cb); if (i >= 0) ls.splice(i, 1); },
      hasListener: function (cb) { return ls.indexOf(cb) >= 0; },
      hasListeners: function () { return ls.length > 0; },
      dispatch: function () {
        var a = arguments;
        ls.slice().forEach(function (cb) { try { cb.apply(null, a); } catch (e) { console.error(e); } });
      },
    };
  }

  function define(obj, key, value) {
    try { obj[key] = value; if (obj[key] === value) return true; } catch (e) {}
    try {
      Object.defineProperty(obj, key, { value: value, configurable: true, writable: true, enumerable: true });
      return obj[key] === value;
    } catch (e) {}
    return false;
  }

  function safeGet(obj, key) { try { return obj[key]; } catch (e) { return undefined; } }

  // a. chrome.windows.onRemoved
  try {
    if (!chrome.windows) define(chrome, 'windows', {});
    if (chrome.windows && !chrome.windows.onRemoved) {
      var noop = makeEvent();
      define(chrome.windows, 'onRemoved', noop);
    }
  } catch (e) { console.warn('[electron-shim] windows stub failed', e); }

  // b/c. chrome.storage.sync backed by local
  try {
    var storage = chrome.storage;
    if (!storage) return;
    var local = safeGet(storage, 'local');
    if (!local) return;

    var sync = safeGet(storage, 'sync');
    // Electron installs a native sync area whose methods throw, so replace it unconditionally.
    if (!(sync && sync.__electronShim)) {
      sync = { __electronShim: true };
      // sync is a prefixed namespace inside local so it never collides with real local keys.
      var P = '__sync:';
      var isSyncKey = function (k) { return typeof k === 'string' && k.indexOf(P) === 0; };
      var toPhys = function (k) { return P + k; };
      var keyList = function (keys) { return Array.isArray(keys) ? keys : [keys]; };
      // Run a local method; always returns a promise (callback style used internally).
      var callLocal = function (m, arg) {
        return new Promise(function (resolve, reject) {
          if (typeof local[m] !== 'function') { resolve(undefined); return; }
          var done = function (r) {
            var le = chrome.runtime && safeGet(chrome.runtime, 'lastError');
            if (le) reject(new Error(le.message || String(le))); else resolve(r);
          };
          try {
            var ret = arg === undefined ? local[m](done) : local[m](arg, done);
            if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
          } catch (e) { reject(e); }
        });
      };
      var finish = function (p, cb) {
        if (typeof cb === 'function') {
          p.then(function (r) { cb(r); }, function (e) { console.error('[electron-shim]', e); cb(); });
          return undefined;
        }
        return p;
      };
      var strip = function (o) {
        var out = {};
        for (var k in o) if (isSyncKey(k)) out[k.slice(P.length)] = o[k];
        return out;
      };
      var prefixObj = function (o) {
        var out = {};
        for (var k in o) out[toPhys(k)] = o[k];
        return out;
      };
      sync.get = function (keys, cb) {
        var p;
        if (keys === null || keys === undefined) {
          p = callLocal('get', null).then(function (all) { return strip(all || {}); });
        } else if (typeof keys === 'string' || Array.isArray(keys)) {
          p = callLocal('get', keyList(keys).map(toPhys)).then(function (r) { return strip(r || {}); });
        } else {
          var defaults = keys;
          p = callLocal('get', Object.keys(defaults).map(toPhys)).then(function (r) {
            var got = strip(r || {}), out = {};
            for (var k in defaults) out[k] = Object.prototype.hasOwnProperty.call(got, k) ? got[k] : defaults[k];
            return out;
          });
        }
        return finish(p, cb);
      };
      sync.set = function (items, cb) { return finish(callLocal('set', prefixObj(items || {})), cb); };
      sync.remove = function (keys, cb) { return finish(callLocal('remove', keyList(keys).map(toPhys)), cb); };
      sync.clear = function (cb) {
        var p = callLocal('get', null).then(function (all) {
          var ks = Object.keys(all || {}).filter(isSyncKey);
          return ks.length ? callLocal('remove', ks) : undefined;
        });
        return finish(p, cb);
      };
      sync.getBytesInUse = function (keys, cb) {
        if (typeof keys === 'function') { cb = keys; keys = null; }
        var p;
        if (keys === null || keys === undefined) {
          p = callLocal('get', null).then(function (all) { return Object.keys(all || {}).filter(isSyncKey); })
            .then(function (ks) { return callLocal('getBytesInUse', ks); });
        } else {
          p = callLocal('getBytesInUse', keyList(keys).map(toPhys));
        }
        return finish(p, cb);
      };
      sync.setAccessLevel = function (opts, cb) { return finish(callLocal('setAccessLevel', opts), cb); };
      sync.QUOTA_BYTES = 102400;
      sync.QUOTA_BYTES_PER_ITEM = 8192;
      sync.MAX_ITEMS = 512;
      sync.MAX_WRITE_OPERATIONS_PER_HOUR = 1800;
      sync.MAX_WRITE_OPERATIONS_PER_MINUTE = 120;
      var syncEvent = makeEvent();
      sync.onChanged = syncEvent;

      var realOnChanged = safeGet(storage, 'onChanged');
      if (realOnChanged && typeof realOnChanged.addListener === 'function') {
        var splitChanges = function (changes) {
          var s = {}, l = {}, hs = false, hl = false;
          for (var k in changes) {
            if (isSyncKey(k)) { s[k.slice(P.length)] = changes[k]; hs = true; }
            else { l[k] = changes[k]; hl = true; }
          }
          return { sync: hs ? s : null, local: hl ? l : null };
        };
        // Forward the sync part of local changes to sync.onChanged (registered on the REAL event, before any proxying).
        realOnChanged.addListener(function (changes, area) {
          if (area !== 'local') return;
          var parts = splitChanges(changes || {});
          if (parts.sync) syncEvent.dispatch(parts.sync);
        });

        // Proxy storage.onChanged: prefixed keys surface as 'sync', others as 'local'.
        var wrappers = new Map();
        var proxy = {
          addListener: function (cb) {
            if (typeof cb !== 'function' || wrappers.has(cb)) return;
            var w = function (changes, area) {
              if (area !== 'local') return cb(changes, area);
              var parts = splitChanges(changes || {});
              if (parts.local) cb(parts.local, 'local');
              if (parts.sync) cb(parts.sync, 'sync');
            };
            wrappers.set(cb, w);
            realOnChanged.addListener(w);
          },
          removeListener: function (cb) {
            var w = wrappers.get(cb);
            if (!w) return;
            wrappers.delete(cb);
            realOnChanged.removeListener(w);
          },
          hasListener: function (cb) { return wrappers.has(cb); },
          hasListeners: function () { return wrappers.size > 0; },
        };
        if (!define(storage, 'onChanged', proxy)) {
          console.warn('[electron-shim] could not replace chrome.storage.onChanged');
        }
      }

      if (!define(storage, 'sync', sync)) {
        console.warn('[electron-shim] could not define chrome.storage.sync on chrome.storage');
      }
    }
    var ok = !!(storage.sync && storage.sync.__electronShim);
    if (ok) g.__electronShimApplied = true;
  } catch (e) { console.warn('[electron-shim] storage shim failed', e); }
})(globalThis);

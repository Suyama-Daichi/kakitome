const http = require('http');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite の Web 版（wa-sqlite）が使う
config.resolver.assetExts.push('wasm');

// SharedArrayBuffer（expo-sqlite の同期 API が必要）には cross-origin isolation が要る。配信用は public/_headers。
// 開発サーバーの HTML は Expo 側のミドルウェアが先に返すので、enhanceMiddleware では付かない。レスポンスに直接足す
const writeHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (...args) {
  if (!this.headersSent) {
    this.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    this.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  return writeHead.apply(this, args);
};

module.exports = config;

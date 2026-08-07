const test = require('node:test');
const assert = require('node:assert');

const {
  isPrivateIp,
  isPrivateHostname,
  isAllowedPlatformUrl,
  extractPublicUrlInfo
} = require('../lib/net-security');

test('isPrivateIp: rango privados IPv4', () => {
  assert.strictEqual(isPrivateIp('10.0.0.1'), true);
  assert.strictEqual(isPrivateIp('192.168.1.1'), true);
  assert.strictEqual(isPrivateIp('172.16.5.5'), true);
  assert.strictEqual(isPrivateIp('172.31.255.255'), true);
  assert.strictEqual(isPrivateIp('169.254.169.254'), true);
  assert.strictEqual(isPrivateIp('127.0.0.1'), true);
  assert.strictEqual(isPrivateIp('0.0.0.0'), true);
});

test('isPrivateIp: IPs publicas NO privadas', () => {
  assert.strictEqual(isPrivateIp('8.8.8.8'), false);
  assert.strictEqual(isPrivateIp('1.1.1.1'), false);
  assert.strictEqual(isPrivateIp('93.184.216.34'), false);
  assert.strictEqual(isPrivateIp('172.32.0.1'), false);
});

test('isPrivateIp: IPv6', () => {
  assert.strictEqual(isPrivateIp('::1'), true);
  assert.strictEqual(isPrivateIp('::'), true);
  assert.strictEqual(isPrivateIp('fc00::1'), true);
  assert.strictEqual(isPrivateIp('fd00::1'), true);
  assert.strictEqual(isPrivateIp('fe80::1'), true);
  assert.strictEqual(isPrivateIp('2001:db8::1'), true);
  assert.strictEqual(isPrivateIp('2606:4700::1'), false);
  assert.strictEqual(isPrivateIp('2001:4860:4860::8888'), false);
});

test('isPrivateHostname: localhost y sufijos locales', () => {
  assert.strictEqual(isPrivateHostname('localhost'), true);
  assert.strictEqual(isPrivateHostname('mi-pc.local'), true);
  assert.strictEqual(isPrivateHostname('internal.service'), false); // no resuelve: no se considera privado por nombre
});

test('isAllowedPlatformUrl: URLs permitidas', () => {
  assert.strictEqual(isAllowedPlatformUrl('https://www.youtube.com/watch?v=abc'), 'youtube');
  assert.strictEqual(isAllowedPlatformUrl('https://youtu.be/abc'), 'youtube');
  assert.strictEqual(isAllowedPlatformUrl('https://www.tiktok.com/@user/video/123'), 'tiktok');
  assert.strictEqual(isAllowedPlatformUrl('https://www.instagram.com/reel/xyz/'), 'instagram');
  assert.strictEqual(isAllowedPlatformUrl('https://x.com/user/status/1'), 'twitter');
  assert.strictEqual(isAllowedPlatformUrl('https://www.reddit.com/r/x/comments/1'), 'reddit');
});

test('isAllowedPlatformUrl: IOs internos y no permitidos', () => {
  assert.strictEqual(isAllowedPlatformUrl('http://127.0.0.1:3000/api/health'), null);
  assert.strictEqual(isAllowedPlatformUrl('http://192.168.1.1/'), null);
  assert.strictEqual(isAllowedPlatformUrl('http://localhost/secret'), null);
  assert.strictEqual(isAllowedPlatformUrl('http://169.254.169.254/latest/meta-data'), null);
  assert.strictEqual(isAllowedPlatformUrl('http://93.184.216.34/video.mp4'), null);
  assert.strictEqual(isAllowedPlatformUrl('file:///etc/passwd'), null);
  assert.strictEqual(isAllowedPlatformUrl('ftp://example.com/x'), null);
  assert.strictEqual(isAllowedPlatformUrl('http://example.com/video.mp4'), null);
  assert.strictEqual(isAllowedPlatformUrl('https://youtube.com.evil.com/x'), null);
});

test('extractPublicUrlInfo: hostname y resuelve IPs publicas', async () => {
  const info = await extractPublicUrlInfo('https://www.youtube.com/watch?v=abc');
  assert.ok(info);
  assert.strictEqual(info.platform, 'youtube');
  assert.strictEqual(info.hostname, 'www.youtube.com');
});

test('extractPublicUrlInfo: rechaza host con resolucion privada', async () => {
  const info = await extractPublicUrlInfo('https://localhost:3000/api/health');
  assert.ok(info);
  assert.strictEqual(info.private, true);
});
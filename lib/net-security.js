const net = require('net');
const dns = require('dns').promises;

const ALLOWED_PLATFORMS = [
    { platform: 'youtube', hosts: ['youtube.com', 'youtu.be', 'm.youtube.com'] },
    { platform: 'tiktok', hosts: ['tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com'] },
    { platform: 'instagram', hosts: ['instagram.com'] },
    { platform: 'twitter', hosts: ['twitter.com', 'x.com'] },
    { platform: 'facebook', hosts: ['facebook.com', 'fb.watch', 'web.facebook.com'] },
    { platform: 'twitch', hosts: ['twitch.tv'] },
    { platform: 'soundcloud', hosts: ['soundcloud.com'] },
    { platform: 'vimeo', hosts: ['vimeo.com'] },
    { platform: 'reddit', hosts: ['reddit.com'] }
];

function isPrivateIpv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return true;
    const [a, b] = parts;
    return (
        a === 10 ||                              // 10.0.0.0/8
        a === 127 ||                             // 127.0.0.0/8 loopback
        (a === 169 && b === 254) ||              // 169.254.0.0/16 link-local
        (a === 172 && b >= 16 && b <= 31) ||     // 172.16.0.0/12
        (a === 192 && b === 168) ||              // 192.168.0.0/16
        (a === 0) ||                             // 0.0.0.0/8
        (a >= 224)                               // multicast / reservado
    );
}

function isPrivateIpv6(ip) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
    if (lower.startsWith('2001:db8')) return true; // documentacion
    if (lower.startsWith('::ffff:')) return isPrivateIpv4(lower.slice(7));
    return false;
}

function isPrivateIp(ip) {
    if (!ip) return true;
    if (net.isIPv4(ip)) return isPrivateIpv4(ip);
    if (net.isIPv6(ip)) return isPrivateIpv6(ip);
    return false;
}

function isPrivateHostname(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    return host === 'localhost' || host.endsWith('.local');
}

function hostAllowed(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    if (isPrivateHostname(host)) return null;
    if (net.isIP(host)) return null;

    for (const entry of ALLOWED_PLATFORMS) {
        const match = entry.hosts.some(h => host === h || host.endsWith('.' + h));
        if (match) return entry.platform;
    }
    return null;
}

async function resolveHostname(hostname) {
    try {
        const addrs = await dns.resolve4(hostname, { ttl: false });
        if (addrs && addrs.length > 0) return addrs;
    } catch (_) {}
    try {
        const addrs = await dns.resolve6(hostname, { ttl: false });
        if (addrs && addrs.length > 0) return addrs;
    } catch (_) {}
    return [];
}

function isAllowedPlatformUrl(urlStr) {
    try {
        const u = new URL(urlStr);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        const platform = hostAllowed(u.hostname);
        if (!platform) return null;
        if (net.isIP(u.hostname)) return null;
        return platform;
    } catch (_) {
        return null;
    }
}

async function extractPublicUrlInfo(urlStr) {
    try {
        const u = new URL(urlStr);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return { private: true, platform: null, hostname: null };
        const hostname = u.hostname.toLowerCase().replace(/\.$/, '');
        const platform = hostAllowed(hostname);
        if (!platform) return { private: true, platform: null, hostname };

        const ips = await resolveHostname(hostname);
        if (ips.length === 0) return { private: false, platform, hostname, unresolvable: true };
        const private = ips.some(isPrivateIp);
        return { private, platform, hostname, ips };
    } catch (_) {
        return { private: true, platform: null, hostname: null };
    }
}

module.exports = {
    ALLOWED_PLATFORMS,
    isPrivateIp,
    isPrivateHostname,
    isAllowedPlatformUrl,
    extractPublicUrlInfo
};
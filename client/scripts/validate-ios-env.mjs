#!/usr/bin/env node
const apiUrl = process.env.VITE_API_URL?.trim();
const allowInsecure = process.env.ALLOW_INSECURE_IOS_API === '1';

function fail(message) {
    console.error(message);
    console.error('Set VITE_API_URL to your public HTTPS API origin, e.g.:');
    console.error('  VITE_API_URL=https://api.your-domain.com npm run build:ios');
    console.error('For local simulator-only debugging, use ALLOW_INSECURE_IOS_API=1 explicitly.');
    process.exit(1);
}

if (!apiUrl) {
    fail('Missing VITE_API_URL for iOS build.');
}

let parsed;
try {
    parsed = new URL(apiUrl);
} catch {
    fail(`Invalid VITE_API_URL: ${apiUrl}`);
}

if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    fail('VITE_API_URL must be an origin only, without path/query/hash.');
}

if (parsed.protocol !== 'https:' && !allowInsecure) {
    fail('VITE_API_URL must use https:// for iOS/TestFlight builds.');
}

if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(parsed.hostname) && !allowInsecure) {
    fail('VITE_API_URL must not point to localhost for iOS/TestFlight builds.');
}

console.log(`iOS API URL OK: ${parsed.origin}`);

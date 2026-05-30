#!/usr/bin/env node
const apiUrl = process.env.VITE_API_URL?.trim();
const allowInsecure = process.env.ALLOW_INSECURE_IOS_API === '1';

function fail(message) {
    console.error(message);
    process.exit(1);
}

if (!apiUrl) {
    fail('Missing VITE_API_URL for iOS API smoke check.');
}

let parsed;
try {
    parsed = new URL(apiUrl);
} catch {
    fail(`Invalid VITE_API_URL: ${apiUrl}`);
}

if (parsed.protocol !== 'https:' && !allowInsecure) {
    fail('VITE_API_URL must use https:// for iOS/TestFlight API smoke check.');
}

const healthUrl = new URL('/api/health', parsed.origin);
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 8000);

try {
    const response = await fetch(healthUrl, {
        headers: { Origin: 'capacitor://localhost' },
        signal: controller.signal,
    });
    const allowOrigin = response.headers.get('access-control-allow-origin');

    if (!response.ok) {
        fail(`iOS API health check failed: ${response.status} ${response.statusText}`);
    }

    const body = await response.json();
    if (body?.ok !== true) {
        fail('iOS API health check failed: unexpected response body.');
    }

    if (allowOrigin !== 'capacitor://localhost' && allowOrigin !== '*') {
        fail('iOS API CORS check failed: capacitor://localhost is not allowed.');
    }

    console.log(`iOS API smoke check passed: ${healthUrl.origin}`);
} catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
        fail(`iOS API health check timed out: ${healthUrl.href}`);
    }
    fail(`iOS API health check failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
    clearTimeout(timeout);
}

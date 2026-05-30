#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, '..');
const iosAppDir = path.join(clientDir, 'ios/App/App');
const assetsDir = path.join(iosAppDir, 'Assets.xcassets');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function pngDimensions(buffer) {
    assert(buffer.length >= 24, 'PNG file is too small');
    assert(buffer.toString('hex', 0, 8) === '89504e470d0a1a0a', 'File is not a PNG');
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}

function expectedIconPixels(size, scale) {
    const points = Number(size.split('x')[0]);
    const multiplier = Number(scale.replace('x', ''));
    return Math.round(points * multiplier);
}

async function readJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readInfoPlist() {
    const { stdout } = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', path.join(iosAppDir, 'Info.plist')]);
    return JSON.parse(stdout);
}

async function checkInfoPlist() {
    const plist = await readInfoPlist();
    assert(plist.CFBundleDisplayName === 'Trạm Đọc', 'CFBundleDisplayName must be Trạm Đọc');
    assert(plist.ITSAppUsesNonExemptEncryption === false, 'ITSAppUsesNonExemptEncryption must be false');
    assert(Array.isArray(plist.UISupportedInterfaceOrientations), 'Missing iPhone orientations');
    assert(plist.UISupportedInterfaceOrientations.length === 1 && plist.UISupportedInterfaceOrientations[0] === 'UIInterfaceOrientationPortrait', 'iPhone orientations must be portrait-only');
    assert(Array.isArray(plist['UISupportedInterfaceOrientations~ipad']) && plist['UISupportedInterfaceOrientations~ipad'].length >= 4, 'iPad orientations should stay fully supported');
}

async function checkCapacitorConfig() {
    const config = await readJson(path.join(iosAppDir, 'capacitor.config.json'));
    assert(config.appId === 'com.tramdoc.app', 'Capacitor appId must be com.tramdoc.app');
    assert(config.appName === 'Trạm Đọc', 'Capacitor appName must be Trạm Đọc');
    assert(!config.server?.url, 'Release iOS config must not include a dev server URL');
    assert(config.server?.cleartext !== true, 'Release iOS config must not allow cleartext traffic');
}

async function checkAppIcons() {
    await readJson(path.join(assetsDir, 'Contents.json'));
    const iconDir = path.join(assetsDir, 'AppIcon.appiconset');
    const contents = await readJson(path.join(iconDir, 'Contents.json'));
    assert(Array.isArray(contents.images), 'AppIcon Contents.json must include images');

    const required = new Set([
        'iphone:20x20:2x', 'iphone:20x20:3x', 'iphone:29x29:2x', 'iphone:29x29:3x',
        'iphone:40x40:2x', 'iphone:40x40:3x', 'iphone:60x60:2x', 'iphone:60x60:3x',
        'ipad:20x20:1x', 'ipad:20x20:2x', 'ipad:29x29:1x', 'ipad:29x29:2x',
        'ipad:40x40:1x', 'ipad:40x40:2x', 'ipad:76x76:1x', 'ipad:76x76:2x',
        'ipad:83.5x83.5:2x', 'ios-marketing:1024x1024:1x',
    ]);

    for (const image of contents.images) {
        const key = `${image.idiom}:${image.size}:${image.scale}`;
        required.delete(key);
        assert(image.filename, `Missing filename for ${key}`);
        const filePath = path.join(iconDir, image.filename);
        const dimensions = pngDimensions(await fs.readFile(filePath));
        const expected = expectedIconPixels(image.size, image.scale);
        assert(dimensions.width === expected && dimensions.height === expected, `${image.filename} must be ${expected}x${expected}, got ${dimensions.width}x${dimensions.height}`);
    }

    assert(required.size === 0, `Missing app icon slots: ${Array.from(required).join(', ')}`);
}

async function checkSplash() {
    const splashDir = path.join(assetsDir, 'Splash.imageset');
    const contents = await readJson(path.join(splashDir, 'Contents.json'));
    assert(Array.isArray(contents.images) && contents.images.length >= 3, 'Splash.imageset must include 1x/2x/3x images');

    for (const image of contents.images) {
        assert(image.filename, `Missing splash filename for ${image.scale}`);
        const dimensions = pngDimensions(await fs.readFile(path.join(splashDir, image.filename)));
        assert(dimensions.width === 2732 && dimensions.height === 2732, `${image.filename} must be 2732x2732`);
    }
}

await checkInfoPlist();
await checkCapacitorConfig();
await checkAppIcons();
await checkSplash();
console.log('iOS native checks passed.');

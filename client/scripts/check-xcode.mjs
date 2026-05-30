#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, '..');

async function assertPath(relativePath) {
    try {
        await fs.access(path.join(clientDir, relativePath));
    } catch {
        throw new Error(`Missing ${relativePath}`);
    }
}

async function run(command, args) {
    try {
        const { stdout } = await execFileAsync(command, args, { timeout: 15000 });
        return stdout.trim();
    } catch (error) {
        throw new Error(`${command} ${args.join(' ')} failed. Install/open full Xcode and run: sudo xcode-select -s /Applications/Xcode.app`);
    }
}

try {
    await assertPath('ios/App/App.xcodeproj/project.pbxproj');
    await assertPath('ios/App/App/Info.plist');
    await assertPath('ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json');

    const xcodeVersion = await run('xcodebuild', ['-version']);
    await run('xcrun', ['simctl', 'list', 'devices', 'available']);

    console.log('Xcode check passed.');
    console.log(xcodeVersion);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}

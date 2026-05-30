#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, '..');
const projectPath = path.join(clientDir, 'ios/App/App.xcodeproj/project.pbxproj');

const [version, build] = process.argv.slice(2);

function fail(message) {
    console.error(message);
    console.error('Usage: npm run ios:set-version -- <marketing-version> <build-number>');
    console.error('Example: npm run ios:set-version -- 1.0 2');
    process.exit(1);
}

if (!version || !/^\d+(?:\.\d+){0,2}$/.test(version)) {
    fail('Invalid marketing version. Use 1, 1.0, or 1.0.0 style values.');
}

if (!build || !/^\d+$/.test(build) || Number(build) < 1) {
    fail('Invalid build number. Use a positive integer.');
}

let project = await fs.readFile(projectPath, 'utf8');
project = project
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);

await fs.writeFile(projectPath, project);
console.log(`Updated iOS version to ${version} (${build}).`);

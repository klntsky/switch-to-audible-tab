/* global __dirname process require */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sharedEntries = ['img', 'static'];
const sourceFiles = ['background.js', 'service-worker.js'];
const packages = [
    { manifest: 'manifest.json', output: 'switch-to-audible-tab.xpi' },
    { manifest: 'manifest.chrome.json', output: 'switch-to-audible-tab.zip' },
];

const stageExtension = (manifest, stagingDirectory) => {
    for (const entry of sharedEntries) {
        fs.cpSync(
            path.join(root, entry),
            path.join(stagingDirectory, entry),
            { recursive: true }
        );
    }

    const stagedSource = path.join(stagingDirectory, 'src');
    fs.mkdirSync(stagedSource);
    for (const sourceFile of sourceFiles) {
        fs.copyFileSync(
            path.join(root, 'src', sourceFile),
            path.join(stagedSource, sourceFile)
        );
    }

    fs.copyFileSync(
        path.join(root, manifest),
        path.join(stagingDirectory, 'manifest.json')
    );
};

const createPackage = target => {
    const stagingDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'switch-to-audible-tab-')
    );

    try {
        stageExtension(target.manifest, stagingDirectory);

        const output = path.join(root, target.output);
        fs.rmSync(output, { force: true });
        const result = spawnSync(
            'zip',
            ['-qr', output, 'img', 'static', 'src', 'manifest.json'],
            { cwd: stagingDirectory, stdio: 'inherit' }
        );

        if (result.error) {
            throw result.error;
        }
        if (result.status !== 0) {
            throw new Error(`zip exited with status ${result.status}`);
        }

        console.log(`Created ${target.output} from ${target.manifest}`);
    } finally {
        fs.rmSync(stagingDirectory, { recursive: true, force: true });
    }
};

if (require.main === module) {
    packages.forEach(createPackage);
}

module.exports = { stageExtension };

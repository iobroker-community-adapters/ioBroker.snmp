/**
 * Build steps of the admin part of this adapter.
 *
 * The backend is compiled by `npm run build-backend` (plain tsc). Everything that has to happen on
 * top of that lives here - currently the vite / module federation build of the MIB browser
 * component under src-admin/, whose output is copied into admin/custom/.
 *
 * Run one step on its own with `npm run 0-clean` ... `npm run 3-copy` when debugging a failed build.
 */
import { buildReact, copyFiles, deleteFoldersRecursive, npmInstall } from '@iobroker/build-tools';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const src = `${__dirname}/src-admin/`;
const buildDir = `${src}build`;

function clean(): void {
    // everything in admin/ except the files which are maintained by hand
    deleteFoldersRecursive(`${__dirname}/admin`, ['snmp.png', 'jsonConfig.json', 'i18n']);
    deleteFoldersRecursive(buildDir);
}

/**
 * collectChunks - the chunks customComponents.js needs, following the imports transitively
 *
 *		vite also emits the standalone simulation (index.html -> src/index.tsx -> App.tsx) into
 *		build/assets/. The admin never loads it, so copying assets/* as a whole would put a few
 *		hundred kB of dead code into the npm package. Starting at the federation entry and following
 *		its relative imports gives exactly the files that are really reachable.
 *
 * @param entry file name of the federation entry inside the build directory
 * @returns paths of the reachable files, relative to the build directory
 */
function collectChunks(entry: string): string[] {
    const seen = new Set<string>();
    const pending = [entry];

    while (pending.length) {
        const file = pending.pop() as string;
        if (seen.has(file)) {
            continue;
        }
        seen.add(file);

        let content: string;
        try {
            content = readFileSync(join(buildDir, file), 'utf8');
        } catch {
            // a referenced file that does not exist is reported by the caller, not here
            continue;
        }

        const dir = dirname(file);
        for (const match of content.matchAll(/["'`](\.\/[^"'`]+\.js)["'`]/g)) {
            const target = join(dir, match[1]).replace(/\\/g, '/');
            if (!seen.has(target)) {
                pending.push(target);
            }
        }
    }

    return [...seen];
}

function copyAllFiles(): void {
    const chunks = collectChunks('customComponents.js');
    console.log(`Copying ${chunks.length} reachable chunk(s) to admin/custom`);

    for (const chunk of chunks) {
        const target = join(`${__dirname}/admin/custom`, chunk);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(buildDir, chunk), target);
        // the source maps are optional - they make a stack trace from the admin readable
        try {
            copyFileSync(join(buildDir, `${chunk}.map`), `${target}.map`);
        } catch {
            /* no source map for this chunk */
        }
    }

    // The admin reads this manifest to see which component library the build was made against and
    // refuses to start the component if it targets an older GUI API generation.
    copyFiles(['src-admin/build/mf-manifest.json'], 'admin/custom');
    copyFiles(['src-admin/src/i18n/*.json'], 'admin/custom/i18n');
}

if (process.argv.includes('--0-clean')) {
    clean();
} else if (process.argv.includes('--1-npm')) {
    npmInstall(src).catch((e: unknown) => {
        console.error(`Cannot install npm: ${e as string}`);
        process.exit(1);
    });
} else if (process.argv.includes('--2-build')) {
    buildReact(src, { rootDir: __dirname, vite: true }).catch((e: unknown) => {
        console.error(`Cannot build react: ${e as string}`);
        process.exit(1);
    });
} else if (process.argv.includes('--3-copy')) {
    copyAllFiles();
} else {
    clean();
    npmInstall(src)
        .then(() => buildReact(src, { rootDir: __dirname, vite: true }))
        .then(() => copyAllFiles())
        .catch((e: unknown) => {
            console.error(`Cannot build: ${e as string}`);
            process.exit(1);
        });
}

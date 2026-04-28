import path from 'node:path';
import process from 'node:process';
import esbuild from 'esbuild';
import fs from 'fs-extra';

const EXCALIDRAW_PROD = path.resolve(__dirname, '../node_modules/@excalidraw/excalidraw/dist/prod');
const IFRAME_ASSETS = path.resolve(__dirname, '../iframe/excalidraw-assets');

/**
 * Copy Excalidraw production assets (fonts, locales, chunks, data, CSS)
 * to iframe/excalidraw-assets/ for fully offline usage.
 */
function copyExcalidrawAssets() {
	// Clean and recreate
	fs.removeSync(IFRAME_ASSETS);
	fs.ensureDirSync(IFRAME_ASSETS);

	// Copy fonts
	if (fs.existsSync(path.join(EXCALIDRAW_PROD, 'fonts'))) {
		fs.copySync(path.join(EXCALIDRAW_PROD, 'fonts'), path.join(IFRAME_ASSETS, 'fonts'));
	}

	// Copy locales
	if (fs.existsSync(path.join(EXCALIDRAW_PROD, 'locales'))) {
		fs.copySync(path.join(EXCALIDRAW_PROD, 'locales'), path.join(IFRAME_ASSETS, 'locales'));
	}

	// Copy data
	if (fs.existsSync(path.join(EXCALIDRAW_PROD, 'data'))) {
		fs.copySync(path.join(EXCALIDRAW_PROD, 'data'), path.join(IFRAME_ASSETS, 'data'));
	}

	// Copy chunk files
	const prodFiles = fs.readdirSync(EXCALIDRAW_PROD);
	for (const file of prodFiles) {
		if (file.startsWith('chunk-') || file.startsWith('subset-')) {
			fs.copySync(path.join(EXCALIDRAW_PROD, file), path.join(IFRAME_ASSETS, file));
		}
	}

	// Copy CSS
	if (fs.existsSync(path.join(EXCALIDRAW_PROD, 'index.css'))) {
		fs.copySync(path.join(EXCALIDRAW_PROD, 'index.css'), path.join(IFRAME_ASSETS, 'index.css'));
	}

	console.warn('[iframe-build] Excalidraw assets copied to iframe/excalidraw-assets/');
}

async function build() {
	copyExcalidrawAssets();

	const ctx = await esbuild.context({
		entryPoints: ['./iframe/src/excalidraw-app.tsx'],
		bundle: true,
		minify: true,
		outfile: './iframe/dist/excalidraw-app.js',
		platform: 'browser',
		format: 'iife',
		target: 'es2020',
		jsx: 'automatic',
		loader: {
			'.tsx': 'tsx',
			'.ts': 'ts',
			'.woff2': 'file',
			'.woff': 'file',
			'.ttf': 'file',
		},
		define: {
			'process.env.NODE_ENV': '"production"',
		},
		// Excalidraw's dynamic imports (chunks, locales, fonts) are loaded at runtime
		// from the asset path — we only bundle the React app entry point here.
		// The chunks/locales/fonts are served from iframe/excalidraw-assets/.
		external: [],
	});

	if (process.argv.includes('--watch')) {
		await ctx.watch();
	}
	else {
		await ctx.rebuild();
		console.warn('[iframe-build] Excalidraw app bundled to iframe/dist/excalidraw-app.js');
		process.exit();
	}
}

build();

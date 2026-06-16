import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { Excalidraw, exportToBlob, MainMenu } from '@excalidraw/excalidraw';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const STORAGE_KEY = 'excalidraw-data';
const LIBRARY_KEY = 'excalidraw-library';
const PLUGIN_TAG = '[Excalidraw]';
const SAVE_DELAY = 1000;

const LANG_MAP: Record<string, string> = {
	'zh-Hans': 'zh-CN',
	'zh-Hant': 'zh-TW',
	'ja': 'ja-JP',
	'ko': 'ko-KR',
	'ru': 'ru-RU',
	'de': 'de-DE',
	'fr': 'fr-FR',
	'es': 'es-ES',
	'pt': 'pt-BR',
	'it': 'it-IT',
	'en': 'en',
};

/** Layers available for binary image (PCB_PrimitiveImage) */
const IMAGE_LAYER_OPTIONS = [
	{ value: 3, label: '顶层丝印 / Top Silkscreen' },
	{ value: 4, label: '底层丝印 / Bottom Silkscreen' },
	{ value: 5, label: '顶层阻焊 / Top Solder Mask' },
	{ value: 6, label: '底层阻焊 / Bottom Solder Mask' },
	{ value: 9, label: '顶层装配 / Top Assembly' },
	{ value: 10, label: '底层装配 / Bottom Assembly' },
	{ value: 13, label: '文档层 / Document' },
	{ value: 14, label: '机械层 / Mechanical' },
	{ value: 1, label: '顶层铜 / Top Copper' },
	{ value: 2, label: '底层铜 / Bottom Copper' },
];

/** Layers available for color image (PCB_PrimitiveObject) */
const OBJECT_LAYER_OPTIONS = [
	{ value: 3, label: '顶层丝印 / Top Silkscreen' },
	{ value: 4, label: '底层丝印 / Bottom Silkscreen' },
	{ value: 13, label: '文档层 / Document' },
];

type ExportMode = 'color' | 'binary';

interface ExportOptions {
	mode: ExportMode;
	background: boolean;
	darkMode: boolean;
	embedScene: boolean;
	scale: number;
	layer: number;
	// binary mode params
	tolerance: number;
	simplification: number;
	smoothing: number;
	despeckling: number;
	whiteBackground: boolean;
	inversion: boolean;
}

function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			resolve(reader.result as string);
		};
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

async function loadImageSize(blob: Blob): Promise<{ width: number; height: number }> {
	const img = new Image();
	const url = URL.createObjectURL(blob);
	return new Promise((resolve, reject) => {
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve({ width: img.naturalWidth, height: img.naturalHeight });
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Image load failed'));
		};
		img.src = url;
	});
}

// ── Export Dialog ──

function ExportDialog({ api, onClose }: {
	api: ExcalidrawImperativeAPI;
	onClose: () => void;
}) {
	const [opts, setOpts] = useState<ExportOptions>({
		mode: 'binary',
		background: false,
		darkMode: false,
		embedScene: false,
		scale: 1,
		layer: 3,
		tolerance: 0.5,
		simplification: 0.5,
		smoothing: 0.5,
		despeckling: 1,
		whiteBackground: true,
		inversion: false,
	});
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [exporting, setExporting] = useState(false);
	const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Ensure layer is valid when switching mode
	const effectiveLayer = opts.mode === 'color'
		? (OBJECT_LAYER_OPTIONS.some(l => l.value === opts.layer) ? opts.layer : 3)
		: opts.layer;

	const generatePreview = useCallback(async () => {
		const elements = api.getSceneElements();
		if (!elements || elements.length === 0) {
			setPreviewUrl(null);
			return;
		}
		try {
			const blob = await exportToBlob({
				elements,
				appState: {
					exportBackground: opts.background,
					exportWithDarkMode: opts.darkMode,
					exportEmbedScene: opts.embedScene,
					exportScale: opts.scale,
				},
				files: api.getFiles(),
				mimeType: 'image/png',
			});

			if (opts.mode === 'binary') {
				// Generate binary preview via canvas threshold
				const { width, height } = await loadImageSize(blob);
				if (width === 0 || height === 0) {
					setPreviewUrl(null);
					return;
				}
				const img = new Image();
				const imgUrl = URL.createObjectURL(blob);
				await new Promise<void>((resolve) => {
					img.onload = () => {
						URL.revokeObjectURL(imgUrl);
						resolve();
					};
					img.src = imgUrl;
				});
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(img, 0, 0);
				const imageData = ctx.getImageData(0, 0, width, height);
				const data = imageData.data;
				const threshold = Math.round((1 - opts.tolerance) * 255);
				for (let i = 0; i < data.length; i += 4) {
					const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
					const alpha = data[i + 3];
					let isBlack = alpha > 10 && gray < threshold;
					if (opts.inversion)
						isBlack = !isBlack;
					if (isBlack) {
						data[i] = data[i + 1] = data[i + 2] = 0;
						data[i + 3] = 255;
					}
					else {
						data[i] = data[i + 1] = data[i + 2] = 255;
						data[i + 3] = opts.whiteBackground ? 255 : 0;
					}
				}
				ctx.putImageData(imageData, 0, 0);
				const binaryUrl = canvas.toDataURL('image/png');
				setPreviewUrl((prev) => {
					if (prev?.startsWith('blob:'))
						URL.revokeObjectURL(prev);
					return binaryUrl;
				});
			}
			else {
				const url = URL.createObjectURL(blob);
				setPreviewUrl((prev) => {
					if (prev?.startsWith('blob:'))
						URL.revokeObjectURL(prev);
					return url;
				});
			}
		}
		catch (err) {
			console.error(PLUGIN_TAG, 'Preview failed:', err);
		}
	}, [api, opts]);

	useEffect(() => {
		if (previewTimerRef.current)
			clearTimeout(previewTimerRef.current);
		previewTimerRef.current = setTimeout(generatePreview, 300);
		return () => {
			if (previewTimerRef.current)
				clearTimeout(previewTimerRef.current);
		};
	}, [generatePreview]);

	useEffect(() => {
		return () => {
			if (previewUrl?.startsWith('blob:'))
				URL.revokeObjectURL(previewUrl);
		};
	}, []);

	const handleExport = useCallback(async () => {
		if (exporting)
			return;
		setExporting(true);
		try {
			const elements = api.getSceneElements();
			if (!elements || elements.length === 0) {
				eda.sys_Dialog.showInformationMessage(eda.sys_I18n.text('没有可导出的元素，请先绘制内容。'));
				return;
			}
			const docInfo = await eda.dmt_SelectControl.getCurrentDocumentInfo();
			if (!docInfo || (docInfo.documentType !== 3 && docInfo.documentType !== 4)) {
				const msg = docInfo?.documentType === 1
					? eda.sys_I18n.text('暂不支持原理图界面导出，目前仅支持 PCB 界面导出。')
					: eda.sys_I18n.text('请先打开 PCB 文档再导出到嘉立创EDA。');
				eda.sys_Dialog.showInformationMessage(msg);
				return;
			}

			const blob = await exportToBlob({
				elements,
				appState: {
					exportBackground: opts.background,
					exportWithDarkMode: opts.darkMode,
					exportEmbedScene: opts.embedScene,
					exportScale: opts.scale,
				},
				files: api.getFiles(),
				mimeType: 'image/png',
			});
			const { width, height } = await loadImageSize(blob);
			if (width === 0 || height === 0) {
				eda.sys_Dialog.showInformationMessage(eda.sys_I18n.text('没有可导出的元素，请先绘制内容。'));
				return;
			}

			let result: any;
			if (opts.mode === 'binary') {
				const complexPolygon = await eda.pcb_MathPolygon.convertImageToComplexPolygon(
					blob,
					width,
					height,
					opts.tolerance,
					opts.simplification,
					opts.smoothing,
					opts.despeckling,
					opts.whiteBackground,
					opts.inversion,
				);
				if (!complexPolygon) {
					eda.sys_Dialog.showInformationMessage(eda.sys_I18n.text('图像转换为 PCB 多边形数据失败。'));
					return;
				}
				result = await eda.pcb_PrimitiveImage.create(
					0,
					0,
					complexPolygon,
					effectiveLayer,
					width,
					height,
				);
			}
			else {
				const base64 = await blobToBase64(blob);
				result = await eda.pcb_PrimitiveObject.create(
					effectiveLayer,
					0,
					0,
					base64,
					width,
					height,
					0,
					false,
					'excalidraw-export.png',
				);
			}

			if (result) {
				eda.sys_Dialog.showInformationMessage(eda.sys_I18n.text('绘图已成功导出到 PCB！'));
				onClose();
			}
			else {
				eda.sys_Dialog.showInformationMessage(eda.sys_I18n.text('导出绘图到 PCB 失败。'));
			}
		}
		catch (err) {
			console.error(PLUGIN_TAG, 'Export failed:', err);
			eda.sys_Dialog.showInformationMessage(eda.sys_I18n.text('导出绘图到 PCB 失败。'));
		}
		finally {
			setExporting(false);
		}
	}, [api, opts, effectiveLayer, exporting, onClose]);

	const labelStyle: React.CSSProperties = {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		padding: '5px 0',
		fontSize: '13px',
	};
	const checkboxStyle: React.CSSProperties = { width: 16, height: 16, cursor: 'pointer' };
	const selectStyle: React.CSSProperties = { padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc' };
	const rangeLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };

	const layerOptions = opts.mode === 'color' ? OBJECT_LAYER_OPTIONS : IMAGE_LAYER_OPTIONS;

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				zIndex: 9999,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				background: 'rgba(0,0,0,0.4)',
			}}
			onClick={(e) => {
				if (e.target === e.currentTarget)
					onClose();
			}}
		>
			<div style={{
				background: '#fff',
				borderRadius: 8,
				padding: 20,
				width: 520,
				maxHeight: '90vh',
				overflow: 'auto',
				boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
			}}
			>
				{/* Header */}
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
					<h3 style={{ margin: 0, fontSize: 16 }}>{eda.sys_I18n.text('导出到嘉立创EDA标题')}</h3>
					<button
						type="button"
						onClick={onClose}
						style={{
							background: 'none',
							border: 'none',
							fontSize: 20,
							cursor: 'pointer',
							padding: '0 4px',
						}}
					>
						✕
					</button>
				</div>

				{/* Mode selector */}
				<div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
					{(['binary', 'color'] as ExportMode[]).map(m => (
						<button
							key={m}
							type="button"
							onClick={() => setOpts(p => ({ ...p, mode: m }))}
							style={{
								flex: 1,
								padding: '8px 0',
								borderRadius: 6,
								fontSize: 13,
								cursor: 'pointer',
								border: opts.mode === m ? '2px solid #4caf50' : '1px solid #ccc',
								background: opts.mode === m ? '#e8f5e9' : '#fff',
								fontWeight: opts.mode === m ? 600 : 400,
							}}
						>
							{eda.sys_I18n.text(m === 'binary' ? '二值化图' : '彩图')}
						</button>
					))}
				</div>

				{/* Preview */}
				<div style={{
					background: opts.darkMode ? '#1e1e1e' : (opts.mode === 'binary' ? '#fff' : '#f5f5f5'),
					borderRadius: 6,
					padding: 12,
					marginBottom: 12,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					minHeight: 160,
					border: '1px solid #e0e0e0',
				}}
				>
					{previewUrl
						? <img src={previewUrl} alt="preview" style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }} />
						: <span style={{ color: '#999', fontSize: 13 }}>{eda.sys_I18n.text('没有可导出的元素，请先绘制内容。')}</span>}
				</div>

				{/* Common options */}
				<div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
					<label style={labelStyle}>
						<span>{eda.sys_I18n.text('背景')}</span>
						<input
							type="checkbox"
							checked={opts.background}
							style={checkboxStyle}
							onChange={e => setOpts(p => ({ ...p, background: e.target.checked }))}
						/>
					</label>
					<label style={labelStyle}>
						<span>{eda.sys_I18n.text('深色模式')}</span>
						<input
							type="checkbox"
							checked={opts.darkMode}
							style={checkboxStyle}
							onChange={e => setOpts(p => ({ ...p, darkMode: e.target.checked }))}
						/>
					</label>
					<label style={labelStyle}>
						<span>{eda.sys_I18n.text('包含画布数据')}</span>
						<input
							type="checkbox"
							checked={opts.embedScene}
							style={checkboxStyle}
							onChange={e => setOpts(p => ({ ...p, embedScene: e.target.checked }))}
						/>
					</label>
					<label style={labelStyle}>
						<span>{eda.sys_I18n.text('缩放比例')}</span>
						<select
							value={opts.scale}
							style={selectStyle}
							onChange={e => setOpts(p => ({ ...p, scale: Number(e.target.value) }))}
						>
							{[1, 2, 3, 4].map(v => (
								<option key={v} value={v}>
									{v}
									x
								</option>
							))}
						</select>
					</label>
					<label style={labelStyle}>
						<span>{eda.sys_I18n.text('导出层')}</span>
						<select
							value={effectiveLayer}
							style={selectStyle}
							onChange={e => setOpts(p => ({ ...p, layer: Number(e.target.value) }))}
						>
							{layerOptions.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
						</select>
					</label>
				</div>

				{/* Binary mode specific options */}
				{opts.mode === 'binary' && (
					<div style={{ borderTop: '1px solid #eee', marginTop: 8, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 1 }}>
						<label style={labelStyle}>
							<span>{eda.sys_I18n.text('容差')}</span>
							<div style={rangeLabel}>
								<input
									type="range"
									min="0"
									max="1"
									step="0.05"
									value={opts.tolerance}
									onChange={e => setOpts(p => ({ ...p, tolerance: Number(e.target.value) }))}
								/>
								<span style={{ minWidth: 32, textAlign: 'right' }}>{opts.tolerance.toFixed(2)}</span>
							</div>
						</label>
						<label style={labelStyle}>
							<span>{eda.sys_I18n.text('简化')}</span>
							<div style={rangeLabel}>
								<input
									type="range"
									min="0"
									max="1"
									step="0.05"
									value={opts.simplification}
									onChange={e => setOpts(p => ({ ...p, simplification: Number(e.target.value) }))}
								/>
								<span style={{ minWidth: 32, textAlign: 'right' }}>{opts.simplification.toFixed(2)}</span>
							</div>
						</label>
						<label style={labelStyle}>
							<span>{eda.sys_I18n.text('平滑')}</span>
							<div style={rangeLabel}>
								<input
									type="range"
									min="0"
									max="1.33"
									step="0.05"
									value={opts.smoothing}
									onChange={e => setOpts(p => ({ ...p, smoothing: Number(e.target.value) }))}
								/>
								<span style={{ minWidth: 32, textAlign: 'right' }}>{opts.smoothing.toFixed(2)}</span>
							</div>
						</label>
						<label style={labelStyle}>
							<span>{eda.sys_I18n.text('去斑')}</span>
							<div style={rangeLabel}>
								<input
									type="range"
									min="0"
									max="5"
									step="0.5"
									value={opts.despeckling}
									onChange={e => setOpts(p => ({ ...p, despeckling: Number(e.target.value) }))}
								/>
								<span style={{ minWidth: 32, textAlign: 'right' }}>{opts.despeckling.toFixed(1)}</span>
							</div>
						</label>
						<label style={labelStyle}>
							<span>{eda.sys_I18n.text('白色作为背景色')}</span>
							<input
								type="checkbox"
								checked={opts.whiteBackground}
								style={checkboxStyle}
								onChange={e => setOpts(p => ({ ...p, whiteBackground: e.target.checked }))}
							/>
						</label>
						<label style={labelStyle}>
							<span>{eda.sys_I18n.text('反相')}</span>
							<input
								type="checkbox"
								checked={opts.inversion}
								style={checkboxStyle}
								onChange={e => setOpts(p => ({ ...p, inversion: e.target.checked }))}
							/>
						</label>
					</div>
				)}

				{/* Actions */}
				<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
					<button
						type="button"
						onClick={onClose}
						style={{
							padding: '8px 16px',
							borderRadius: 6,
							border: '1px solid #ccc',
							background: '#fff',
							cursor: 'pointer',
							fontSize: 13,
						}}
					>
						{eda.sys_I18n.text('取消')}
					</button>
					<button
						type="button"
						onClick={handleExport}
						disabled={exporting}
						style={{
							padding: '8px 16px',
							borderRadius: 6,
							border: '1px solid #4caf50',
							background: '#4caf50',
							color: '#fff',
							cursor: exporting ? 'not-allowed' : 'pointer',
							fontSize: 13,
							opacity: exporting ? 0.6 : 1,
						}}
					>
						{exporting ? '...' : eda.sys_I18n.text('导出')}
					</button>
				</div>
			</div>
		</div>
	);
}

// ── Main App ──

function App() {
	const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [initialData, setInitialData] = useState<any>(undefined);
	const [initialLibrary, setInitialLibrary] = useState<any[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [langCode, setLangCode] = useState('en');
	const [showExportDialog, setShowExportDialog] = useState(false);

	useEffect(() => {
		(async () => {
			try {
				const edaLang = await eda.sys_I18n.getCurrentLanguage();
				setLangCode(LANG_MAP[edaLang] || 'en');
			}
			catch {
				console.warn(PLUGIN_TAG, 'Failed to get language');
			}
			try {
				const raw = await eda.sys_Storage.getExtensionUserConfig(STORAGE_KEY);
				if (raw)
					setInitialData(JSON.parse(raw));
			}
			catch {
				console.warn(PLUGIN_TAG, 'No saved data');
			}
			try {
				const libRaw = await eda.sys_Storage.getExtensionUserConfig(LIBRARY_KEY);
				if (libRaw)
					setInitialLibrary(JSON.parse(libRaw));
			}
			catch {
				console.warn(PLUGIN_TAG, 'No saved library');
			}
			setLoaded(true);
		})();
	}, []);

	const handleChange = useCallback((elements: readonly any[], appState: any) => {
		if (saveTimerRef.current)
			clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(async () => {
			try {
				const liveElements = elements.filter((el: any) => !el.isDeleted);
				await eda.sys_Storage.setExtensionUserConfig(STORAGE_KEY, JSON.stringify({
					elements: liveElements,
					appState: {
						viewBackgroundColor: appState.viewBackgroundColor,
						currentItemFontFamily: appState.currentItemFontFamily,
						theme: appState.theme,
					},
				}));
			}
			catch (err) {
				console.error(PLUGIN_TAG, 'Save failed:', err);
			}
		}, SAVE_DELAY);
	}, []);

	const handleLibraryChange = useCallback(async (items: any[]) => {
		try {
			await eda.sys_Storage.setExtensionUserConfig(LIBRARY_KEY, JSON.stringify(items));
		}
		catch (err) {
			console.error(PLUGIN_TAG, 'Library save failed:', err);
		}
	}, []);

	if (!loaded)
		return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading...</div>;

	const sceneData = initialData
		? { ...initialData, libraryItems: initialLibrary }
		: (initialLibrary.length > 0 ? { libraryItems: initialLibrary } : undefined);

	return (
		<div style={{ width: '100vw', height: '100vh' }}>
			<Excalidraw
				langCode={langCode}
				excalidrawAPI={(api) => { apiRef.current = api; }}
				initialData={sceneData}
				onChange={handleChange}
				onLibraryChange={handleLibraryChange}
				renderTopRightUI={() => (
					<button
						type="button"
						onClick={() => setShowExportDialog(true)}
						title={eda.sys_I18n.text('将绘图导出为图像到嘉立创EDA PCB')}
						style={{
							padding: '6px 12px',
							borderRadius: 6,
							border: '1px solid #4caf50',
							background: '#e8f5e9',
							cursor: 'pointer',
							fontSize: 13,
							whiteSpace: 'nowrap',
						}}
					>
						{`📤 ${eda.sys_I18n.text('导出到嘉立创EDA')}`}
					</button>
				)}
			>
				<MainMenu>
					<MainMenu.DefaultItems.LoadScene />
					<MainMenu.DefaultItems.Export />
					<MainMenu.DefaultItems.SaveAsImage />
					<MainMenu.DefaultItems.SearchMenu />
					<MainMenu.DefaultItems.Help />
					<MainMenu.DefaultItems.ClearCanvas />
					<MainMenu.Separator />
					<MainMenu.DefaultItems.ToggleTheme />
					<MainMenu.DefaultItems.ChangeCanvasBackground />
					<MainMenu.Separator />
					<MainMenu.ItemLink href="https://github.com/excalidraw/excalidraw">Excalidraw GitHub</MainMenu.ItemLink>
					<MainMenu.ItemLink href="https://github.com/easyeda/eext-excalidraw">EasyEDA Extension GitHub</MainMenu.ItemLink>
				</MainMenu>
			</Excalidraw>
			{showExportDialog && apiRef.current && (
				<ExportDialog api={apiRef.current} onClose={() => setShowExportDialog(false)} />
			)}
		</div>
	);
}

const container = document.getElementById('root');
if (container) {
	createRoot(container).render(<App />);
}

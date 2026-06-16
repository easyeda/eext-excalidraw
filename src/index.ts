/**
 * 入口文件 — Excalidraw 白板插件
 *
 * 在嘉立创EDA专业版中集成 Excalidraw 手绘风格白板，
 * 用于绘制架构草图、标注设计思路、团队协作讨论。
 */
import * as extensionConfig from '../extension.json';

const PLUGIN_TAG = '[Excalidraw]';
const IFRAME_ID = 'excalidraw-whiteboard';

// eslint-disable-next-line unused-imports/no-unused-vars
export function activate(status?: 'onStartupFinished', arg?: string): void {}

export async function openExcalidraw(): Promise<void> {
	try {
		await eda.sys_IFrame.openIFrame('/iframe/excalidraw.html', 1200, 800, IFRAME_ID, {
			title: eda.sys_I18n.text('Excalidraw 白板'),
			maximizeButton: true,
			minimizeButton: true,
		});
	}
	catch (err) {
		console.error(PLUGIN_TAG, 'Failed to open Excalidraw:', err);
		await eda.sys_Dialog.showInformationMessage(
			eda.sys_I18n.text('打开 Excalidraw 白板失败。'),
		);
	}
}

export function about(): void {
	eda.sys_Dialog.showInformationMessage(
		// eslint-disable-next-line no-template-curly-in-string
		eda.sys_I18n.text('Excalidraw 白板 v${1}', undefined, undefined, extensionConfig.version),
		eda.sys_I18n.text('关于'),
	);
}

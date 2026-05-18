// Main plugin entry point

import { Plugin, WorkspaceLeaf, MarkdownView, TFile, TFolder, Notice } from 'obsidian';
import { SimpleDrawView, VIEW_TYPE_SIMPLEDRAW } from './view';
import { SimpleDrawEngine } from './engine';
import { SimpleDrawSettings, DEFAULT_SETTINGS } from './settings';
import { SimpleDrawSettingTab } from './settingsTab';
import { DEFAULT_DATA, SimpleDrawData } from './types';
import { t, setLanguage } from './locale';

export default class SimpleDrawPlugin extends Plugin {
    public settings: SimpleDrawSettings;

    async onload(): Promise<void> {
        await this.loadSettings();

        // Register custom view
        this.registerView(
            VIEW_TYPE_SIMPLEDRAW,
            (leaf: WorkspaceLeaf) => {
                const view = new SimpleDrawView(leaf, this.settings);
                view.onSettingsSave = () => this.saveSettings();
                return view;
            }
        );

        // Register extensions
        this.registerExtensions(['simpledraw'], VIEW_TYPE_SIMPLEDRAW);

        // Add ribbon icon (left sidebar)
        this.addRibbonIcon('pencil', t('ribbon.insert'), async () => {
            await this.createAndOpenSimpleDraw();
        });

        // Add command to create new drawing
        this.addCommand({
            id: 'create-simple-draw',
            name: t('command.create'),
            callback: async () => {
                await this.createAndOpenSimpleDraw();
            },
        });

        // Add context menu item for folders
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item
                            .setTitle(t('fileMenu.insert'))
                            .setIcon('pencil')
                            .onClick(async () => {
                                await this.createSimpleDrawInFolder(file);
                            });
                    });
                }
            })
        );

        // Add export to leaf (three-dot) menu for SimpleDraw views
        this.registerEvent(
            (this.app.workspace as any).on('leaf-menu', (menu: any, leaf: WorkspaceLeaf) => {
                if (leaf.view?.getViewType() === VIEW_TYPE_SIMPLEDRAW) {
                    menu.addItem((item: any) => {
                        item
                            .setTitle(t('leafMenu.export'))
                            .setIcon('image-file')
                            .onClick(async () => {
                                const view = leaf.view as SimpleDrawView;
                                await view.exportToPNG();
                            });
                    });
                }
            })
        );

        // Settings tab
        this.addSettingTab(new SimpleDrawSettingTab(this.app, this));
    }

    onunload(): void {
        // Plugin cleanup
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        setLanguage(this.settings.language);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    async createAndOpenSimpleDraw(folder?: TFolder): Promise<void> {
        let targetFolder: TFolder;

        if (folder) {
            targetFolder = folder;
        } else {
            // Default to vault root
            const root = this.app.vault.getRoot();
            targetFolder = root;
        }

        const fileName = SimpleDrawEngine.generateFileName();
        const filePath = targetFolder.isRoot() ? fileName : `${targetFolder.path}/${fileName}`;

        // Check for duplicates and adjust name
        let finalPath = filePath;
        let counter = 1;
        while (await this.app.vault.adapter.exists(finalPath)) {
            const baseName = fileName.replace('.simpledraw', '');
            finalPath = targetFolder.isRoot()
                ? `${baseName}_${counter}.simpledraw`
                : `${targetFolder.path}/${baseName}_${counter}.simpledraw`;
            counter++;
        }

        const file = await this.app.vault.create(finalPath, JSON.stringify(DEFAULT_DATA, null, 2));
        await this.app.workspace.getLeaf(true).openFile(file);
    }

    async createSimpleDrawInFolder(folder: TFolder): Promise<void> {
        await this.createAndOpenSimpleDraw(folder);
    }
}

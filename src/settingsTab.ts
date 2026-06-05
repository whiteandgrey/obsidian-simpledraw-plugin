import { App, PluginSettingTab, Setting } from 'obsidian';
import { SimpleDrawSettings, getArrowShapes, ArrowShape, AnchorScheme, ShortcutBinding, getShortcutActions, TextShortcutAction, bindingLabel } from './settings';
import type SimpleDrawPlugin from './main';
import { t, setLanguage, Language } from './locale';

export class SimpleDrawSettingTab extends PluginSettingTab {
    plugin: SimpleDrawPlugin;

    constructor(app: App, plugin: SimpleDrawPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName(t('settings.title')).setHeading();

        // --- Basic settings ---
        const basicSection = this.createCollapsibleSection(containerEl, t('settings.section.basic'), true);
        const basicBody = basicSection.body;

        new Setting(basicBody)
            .setName(t('settings.language.name'))
            .setDesc(t('settings.language.desc'))
            .addDropdown(dropdown => {
                dropdown.addOption('zh', t('language.zh'));
                dropdown.addOption('en', t('language.en'));
                dropdown.setValue(this.plugin.settings.language);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.language = value as Language;
                    setLanguage(value as Language);
                    await this.plugin.saveSettings();
                    this.display();
                });
            });

        new Setting(basicBody)
            .setName(t('settings.showGrid.name'))
            .setDesc(t('settings.showGrid.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showGrid)
                .onChange(async (value) => {
                    this.plugin.settings.showGrid = value;
                    await this.plugin.saveSettings();
                }));

        // --- Arrow settings ---
        const arrowSection = this.createCollapsibleSection(containerEl, t('settings.section.arrow'), true);
        const arrowBody = arrowSection.body;

        new Setting(arrowBody)
            .setName(t('settings.arrowStrokeWidth.name'))
            .setDesc(t('settings.arrowStrokeWidth.desc'))
            .addSlider(slider => slider
                .setLimits(1, 5, 1)
                .setValue(this.plugin.settings.arrowStrokeWidth)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.arrowStrokeWidth = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(arrowBody)
            .setName(t('settings.arrowHeadSize.name'))
            .setDesc(t('settings.arrowHeadSize.desc'))
            .addSlider(slider => slider
                .setLimits(6, 20, 2)
                .setValue(this.plugin.settings.arrowHeadSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.arrowHeadSize = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(arrowBody)
            .setName(t('settings.arrowShape.name'))
            .setDesc(t('settings.arrowShape.desc'))
            .addDropdown(dropdown => {
                for (const shape of getArrowShapes()) {
                    dropdown.addOption(shape.value, shape.label);
                }
                dropdown.setValue(this.plugin.settings.arrowShape);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.arrowShape = value as ArrowShape;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(arrowBody)
            .setName(t('settings.showAnchorDots.name'))
            .setDesc(t('settings.showAnchorDots.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showAnchorDots)
                .onChange(async (value) => {
                    this.plugin.settings.showAnchorDots = value;
                    await this.plugin.saveSettings();
                }));

        // --- Snap settings ---
        const snapSection = this.createCollapsibleSection(containerEl, t('settings.section.snap'), true);
        const snapBody = snapSection.body;

        new Setting(snapBody)
            .setName(t('settings.anchorScheme.name'))
            .setDesc(t('settings.anchorScheme.desc'))
            .addDropdown(dropdown => {
                dropdown.addOption('scheme1', t('settings.anchorScheme.scheme1'));
                dropdown.addOption('scheme2', t('settings.anchorScheme.scheme2'));
                dropdown.setValue(this.plugin.settings.anchorScheme);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.anchorScheme = value as AnchorScheme;
                    await this.plugin.saveSettings();
                });
            });

        new Setting(snapBody)
            .setName(t('settings.snapPreviewRadius.name'))
            .setDesc(t('settings.snapPreviewRadius.desc'))
            .addSlider(slider => slider
                .setLimits(4, 20, 2)
                .setValue(this.plugin.settings.snapPreviewRadius)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.snapPreviewRadius = value;
                    await this.plugin.saveSettings();
                }));

        // --- Textbox settings ---
        const textboxSection = this.createCollapsibleSection(containerEl, t('settings.section.textbox'), true);
        const textboxBody = textboxSection.body;

        new Setting(textboxBody)
            .setName(t('settings.textboxDefaultFontSize.name'))
            .setDesc(t('settings.textboxDefaultFontSize.desc'))
            .addSlider(slider => slider
                .setLimits(8, 72, 2)
                .setValue(this.plugin.settings.textboxDefaultFontSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.textboxDefaultFontSize = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(textboxBody)
            .setName(t('settings.labelDefaultFontSize.name'))
            .setDesc(t('settings.labelDefaultFontSize.desc'))
            .addSlider(slider => slider
                .setLimits(8, 72, 2)
                .setValue(this.plugin.settings.labelDefaultFontSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.labelDefaultFontSize = value;
                    await this.plugin.saveSettings();
                }));

        // --- Shortcut settings ---
        const shortcutsSection = this.createCollapsibleSection(containerEl, t('settings.section.shortcuts'), true);
        const shortcutsBody = shortcutsSection.body;

        const listEl = shortcutsBody.createDiv();
        this.renderShortcutList(listEl);

        const addBtn = shortcutsBody.createEl('button', { text: t('settings.shortcuts.add'), cls: 'sd-add-btn' });
        addBtn.onclick = () => this.startAddShortcut(listEl);
    }

    private createCollapsibleSection(container: HTMLElement, title: string, defaultOpen: boolean): { header: HTMLElement; body: HTMLElement } {
        const section = container.createDiv({ cls: 'sd-settings-section' });

        const header = section.createDiv({ cls: 'sd-settings-header' });

        const arrow = header.createSpan({ cls: 'sd-settings-arrow' });
        arrow.textContent = defaultOpen ? '▼' : '▶';

        const label = header.createSpan({ cls: 'sd-settings-label' });
        label.textContent = title;

        const body = section.createDiv({ cls: 'sd-settings-body' });
        if (!defaultOpen) body.style.display = 'none';

        header.addEventListener('click', () => {
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            arrow.textContent = isOpen ? '▶' : '▼';
        });

        return { header, body };
    }

    private renderShortcutList(container: HTMLElement): void {
        container.empty();
        for (const [i, binding] of this.plugin.settings.shortcuts.entries()) {
            const row = container.createDiv({ cls: 'sd-settings-row' });

            const label = getShortcutActions().find(a => a.value === binding.action);
            const actionName = label ? label.label : binding.action;

            row.createSpan({ text: bindingLabel(binding) + '  →  ' + actionName });

            const delBtn = row.createEl('button', { text: t('settings.shortcuts.delete') });
            delBtn.style.marginLeft = 'auto';
            delBtn.onclick = async () => {
                this.plugin.settings.shortcuts.splice(i, 1);
                await this.plugin.saveSettings();
                this.renderShortcutList(container);
            };
        }
    }

    private startAddShortcut(listContainer: HTMLElement): void {
        const recEl = this.containerEl.createDiv();
        recEl.style.marginTop = '8px';
        recEl.style.padding = '12px';
        recEl.style.border = '1px solid var(--interactive-accent)';
        recEl.style.borderRadius = '6px';

        recEl.createSpan({ text: t('settings.shortcuts.recording') });

        let capturedBinding: ShortcutBinding | null = null;

        const handler = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const keyMap: Record<string, string> = {
                'Control': '', 'Shift': '', 'Alt': '', 'Meta': '',
            };
            if (e.key in keyMap) return;

            capturedBinding = {
                ctrl: e.ctrlKey || e.metaKey,
                shift: e.shiftKey,
                alt: e.altKey,
                key: e.key.toLowerCase(),
                action: 'bold' as TextShortcutAction,
            };

            document.removeEventListener('keydown', handler, true);
            showEditor();
        };

        document.addEventListener('keydown', handler, true);

        const showEditor = () => {
            recEl.empty();

            const binding = capturedBinding!;
            const label = bindingLabel(binding);
            recEl.createSpan({ text: t('settings.shortcuts.keyLabel') + label });

            const dropdown = recEl.createEl('select', { cls: 'sd-rec-dropdown' });

            const btnRow = recEl.createDiv({ cls: 'sd-rec-btn-row' });

            const confirmBtn = btnRow.createEl('button', { text: t('settings.shortcuts.confirm') });
            confirmBtn.onclick = async () => {
                binding.action = dropdown.value as TextShortcutAction;
                // Replace existing binding for same key combo
                const idx = this.plugin.settings.shortcuts.findIndex(
                    b => b.ctrl === binding.ctrl && b.shift === binding.shift && b.alt === binding.alt && b.key === binding.key
                );
                if (idx >= 0) {
                    this.plugin.settings.shortcuts[idx] = binding;
                } else {
                    this.plugin.settings.shortcuts.push(binding);
                }
                await this.plugin.saveSettings();
                recEl.remove();
                this.renderShortcutList(listContainer);
            };

            const cancelBtn = btnRow.createEl('button', { text: t('settings.shortcuts.cancel') });
            cancelBtn.onclick = () => {
                document.removeEventListener('keydown', handler, true);
                recEl.remove();
            };
        };
    }
}

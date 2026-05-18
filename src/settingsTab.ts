import { App, PluginSettingTab, Setting } from 'obsidian';
import { SimpleDrawSettings, getArrowShapes, ArrowShape, ShortcutBinding, getShortcutActions, TextShortcutAction, bindingLabel } from './settings';
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

        containerEl.createEl('h2', { text: t('settings.title') });

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

        // --- Shortcut settings ---
        const shortcutsSection = this.createCollapsibleSection(containerEl, t('settings.section.shortcuts'), true);
        const shortcutsBody = shortcutsSection.body;

        const listEl = shortcutsBody.createDiv();
        this.renderShortcutList(listEl);

        const addBtn = shortcutsBody.createEl('button', { text: t('settings.shortcuts.add') });
        addBtn.style.marginTop = '8px';
        addBtn.onclick = () => this.startAddShortcut(listEl);
    }

    private createCollapsibleSection(container: HTMLElement, title: string, defaultOpen: boolean): { header: HTMLElement; body: HTMLElement } {
        const section = container.createDiv();
        section.style.marginBottom = '12px';
        section.style.border = '1px solid var(--background-modifier-border)';
        section.style.borderRadius = '6px';
        section.style.overflow = 'hidden';

        const header = section.createDiv();
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.padding = '8px 12px';
        header.style.cursor = 'pointer';
        header.style.background = 'var(--background-secondary)';
        header.style.userSelect = 'none';
        header.style.gap = '8px';

        const arrow = header.createSpan();
        arrow.textContent = defaultOpen ? '▼' : '▶';
        arrow.style.fontSize = '10px';
        arrow.style.color = 'var(--text-muted)';
        arrow.style.transition = 'transform 0.15s';

        const label = header.createSpan();
        label.textContent = title;
        label.style.fontWeight = '600';
        label.style.fontSize = '14px';
        label.style.color = 'var(--text-normal)';

        const body = section.createDiv();
        body.style.padding = '8px 12px 12px';
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
            const row = container.createDiv();
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '8px';
            row.style.padding = '6px 0';
            row.style.borderBottom = '1px solid var(--background-modifier-border)';

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

            const dropdown = recEl.createEl('select');
            dropdown.style.marginLeft = '8px';
            for (const a of getShortcutActions()) {
                const opt = dropdown.createEl('option');
                opt.value = a.value;
                opt.textContent = a.label;
            }

            const btnRow = recEl.createDiv();
            btnRow.style.marginTop = '8px';
            btnRow.style.display = 'flex';
            btnRow.style.gap = '8px';

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

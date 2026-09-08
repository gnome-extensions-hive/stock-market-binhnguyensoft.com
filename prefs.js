import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {translator} from './language.js';

export default class StockMarketPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 650);
        let page;
        let draftSymbols = settings.get_strv('symbols');

        const build = () => {
            const t = translator(settings);

            if (page)
                window.remove(page);

            page = new Adw.PreferencesPage({
                title: t('Stock Market Widget', 'Widget Thị trường tài chính'),
                icon_name: 'preferences-desktop-display-symbolic'
            });

            // Ngôn ngữ
            const languages = ['auto', 'en', 'vi'];
            const currentLang = settings.get_string('language');
            const currentIndex = languages.indexOf(currentLang);

            const languageGroup = new Adw.PreferencesGroup({
                description: t(
                    'Language displayed on both the widget and the Preferences window.',
                    'Ngôn ngữ hiển thị trên Widget lẫn cửa sổ Preferences.'
                )
            });

            const languageRow = new Adw.ComboRow({
                title: t('Language', 'Ngôn ngữ'),
                model: Gtk.StringList.new([
                    t('System default', 'Theo hệ thống'),
                    'English',
                    'Tiếng Việt'
                ]),
                selected: currentIndex >= 0 ? currentIndex : 0
            });

            languageRow.connect('notify::selected', row => {
                if (languages[row.selected]) {
                    settings.set_string('language', languages[row.selected]);
                }
            });

            languageGroup.add(languageRow);
            page.add(languageGroup);

            // Vị trí
            const position = new Adw.PreferencesGroup({
                title: t('Position', 'Vị trí'),
                description: t(
                    'Change the widget position.',
                    'Thay đổi vị trí xuất hiện của widget.'
                )
            });

            const addNumberSettingRow = (group, key, title, lower, upper) => {
                const row = new Adw.SpinRow({
                    title, digits: 0, numeric: true,
                    adjustment: new Gtk.Adjustment({lower, upper, step_increment: 5})
                });
                settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
                group.add(row);
            };

            addNumberSettingRow(position, 'left', t('Distance from the left edge (in pixels).', 'Khoảng cách từ mép trái (tính bằng pixel).'), 0, 10000);
            addNumberSettingRow(position, 'top', t('Distance from the top edge (in pixels).', 'Khoảng cách từ mép trên (tính bằng pixel).'), 0, 10000);
            page.add(position);

            // Chu kỳ cập nhật
            const update = new Adw.PreferencesGroup({
                title: t('Updates', 'Cập nhật'),
                description: t(
                    'How often the data refreshes. Note: Setting it below 5 minutes is not recommended to prevent getting rate-limited by Yahoo Finance.',
                    'Bao lâu dữ liệu được nạp lại một lần. Lưu ý: không nên đặt dưới 5 phút để phòng trường hợp server Yahoo Finance chặn.'
                )
            });

            addNumberSettingRow(update, 'duration', t('Update interval (minutes)', 'Chu kỳ cập nhật (phút)'), 5, 300);
            page.add(update);

            // Mã theo dõi
            const symbols = new Adw.PreferencesGroup({
                title: t('Symbols', 'Mã theo dõi'),
                description: t(
                    'Add up to 20 Yahoo Finance symbols. Click Save list after editing to update the widget.',
                    'Thêm tối đa 20 mã Yahoo Finance. Sau khi chỉnh sửa, phải bấm Lưu danh sách để cập nhật widget. Các mã chứng khoán Việt Nam thường có .VN ở sau.'
                )
            });
            
            const addRow = new Adw.ActionRow({title: t('Add symbol', 'Thêm mã')});
            
            const entry = new Gtk.Entry({
                placeholder_text: t('e.g. AAPL', 'Ví dụ: AAPL'),
                hexpand: true,
                valign: Gtk.Align.CENTER,
                width_chars: 16,
            });
            
            addRow.add_suffix(entry);
            
            const button = (row, icon, label, callback) => {
                const control = new Gtk.Button({
                    icon_name: icon,
                    tooltip_text: label,
                    valign: Gtk.Align.CENTER,
                });
                control.connect('clicked', callback);
                row.add_suffix(control);
                return control;
            };
            
            const status = new Adw.ActionRow({visible: false});
            
            let rows = [];
            
            const saveRow = new Adw.ActionRow({
                title: t('Save changes to the widget', 'Lưu thay đổi vào widget'),
                subtitle: t(
                    'Click Save list to update the widget with the new list. Closing without saving discards changes.',
                    'Phải bấm Lưu danh sách để cập nhật widget theo danh sách mới. Đóng mà chưa lưu sẽ bỏ các thay đổi.'
                ),
            });
            
            const saveListButton = new Gtk.Button({
                label: t('Save list', 'Lưu danh sách'),
                valign: Gtk.Align.CENTER,
            });
            
            saveListButton.add_css_class('suggested-action');
            
            saveRow.add_suffix(saveListButton);
            
            saveListButton.connect('clicked', () => {
                if (entry.text.trim() || rows.some(row => row._editor.visible)) {
                    status.title = t(
                        'Add the typed symbol and finish editing with Done before saving the list.',
                        'Hãy thêm mã đang nhập và bấm Xong để hoàn tất sửa mã trước khi lưu danh sách.'
                    );
                    status.visible = true;
                    return;
                }
                if (!settings.set_strv('symbols', draftSymbols)) {
                    status.title = t('Could not save the list. Please try again.', 'Không lưu được danh sách. Vui lòng thử lại.');
                    status.visible = true;
                    return;
                }
                clearError();
                saveRow.title = t('List saved', 'Đã lưu danh sách');
            });
            
            const clearError = () => {
                status.visible = false;
                entry.remove_css_class('error');
            };
            
            const validate = (input, values, original = null) => {
                const value = input.text.trim().toUpperCase();
                let message = '';
                if (!/^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$/.test(value))
                    message = t('Enter one valid symbol (up to 32 characters).', 'Nhập một mã hợp lệ (tối đa 32 ký tự).');
                else if (value !== original && values.includes(value))
                    message = t('This symbol is already in the list.', 'Mã này đã có trong danh sách.');
                else if (original === null && values.length >= 20)
                    message = t('You can track up to 20 symbols.', 'Chỉ có thể theo dõi tối đa 20 mã.');
                    
                status.title = message;
                status.visible = Boolean(message);
                
                if (message)
                    input.add_css_class('error');
                else
                    input.remove_css_class('error');
                    
                return message ? null : value;
            };
            
            const finishEditingFirst = () => {
                if (!rows.some(row => row._editor.visible))
                    return false;
                status.title = t('Finish the current edit with Done or Cancel first.',
                    'Hãy bấm Xong hoặc Hủy để kết thúc sửa mã hiện tại trước.');
                status.visible = true;
                return true;
            };

            const render = () => {
                for (const row of rows)
                    symbols.remove(row);
                rows = [];
                
                saveRow.title = JSON.stringify(draftSymbols) === JSON.stringify(settings.get_strv('symbols'))
                    ? t('Saved list', 'Danh sách đã lưu')
                    : t('Unsaved changes', 'Có thay đổi chưa lưu');
                    
                const values = [...draftSymbols];
                
                values.forEach((symbol, index) => {
                    const row = new Adw.ActionRow({title: symbol});
                    const editor = new Gtk.Entry({
                        text: symbol,
                        visible: false,
                        hexpand: true,
                        width_chars: 12,
                        valign: Gtk.Align.CENTER,
                    });
                    row.add_suffix(editor);
                    row._editor = editor;
                    
                    const save = () => {
                        const current = [...draftSymbols];
                        const value = validate(editor, current, symbol);
                        const position = current.indexOf(symbol);
                        if (value === null || position < 0)
                            return;
                        current[position] = value;
                        draftSymbols = current;
                        clearError();
                        render();
                    };
                    
                    const saveButton = button(row, 'object-select-symbolic', t('Done editing', 'Xong'), save);
                    const cancelButton = button(row, 'edit-undo-symbolic', t('Cancel', 'Hủy'), () => {
                        clearError();
                        render();
                    });
                    saveButton.visible = false;
                    cancelButton.visible = false;
                    
                    editor.connect('activate', save);
                    const editButton = button(row, 'document-edit-symbolic', t('Edit symbol', 'Sửa mã'), () => {
                        if (finishEditingFirst())
                            return;
                        clearError();
                        editor.visible = true;
                        saveButton.visible = true;
                        cancelButton.visible = true;
                        editButton.visible = false;
                        up.visible = false;
                        down.visible = false;
                        remove.visible = false;
                        row.title = '';
                        editor.grab_focus();
                    });
                    
                    const move = offset => {
                        if (finishEditingFirst())
                            return;
                        const current = [...draftSymbols];
                        const position = current.indexOf(symbol);
                        const target = position + offset;
                        if (position < 0 || target < 0 || target >= current.length)
                            return;
                        [current[position], current[target]] = [current[target], current[position]];
                        draftSymbols = current;
                        clearError();
                        render();
                    };
                    const up = button(row, 'go-up-symbolic', t('Move up', 'Chuyển lên'), () => move(-1));
                    const down = button(row, 'go-down-symbolic', t('Move down', 'Chuyển xuống'), () => move(1));
                    up.sensitive = index > 0;
                    down.sensitive = index < values.length - 1;
                    
                    const remove = button(row, 'user-trash-symbolic', t('Delete symbol', 'Xóa mã'), () => {
                        if (finishEditingFirst())
                            return;
                        draftSymbols = draftSymbols.filter(value => value !== symbol);
                        clearError();
                        render();
                    });
                    
                    symbols.add(row);
                    rows.push(row);
                });
            };
            
            const add = () => {
                if (finishEditingFirst())
                    return;
                const values = [...draftSymbols];
                const value = validate(entry, values);
                if (value === null)
                    return;
                draftSymbols = [...values, value];
                entry.text = '';
                clearError();
                render();
                entry.grab_focus();
            };
            
            
            button(addRow, 'list-add-symbolic', t('Add symbol', 'Thêm mã'), add);
            entry.connect('activate', add);
            symbols.add(addRow);
            symbols.add(status);
            symbols.add(saveRow);
            
            render();
            
            
            page.add(symbols);

            window.add(page);
        };

        build();

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._addAboutButton(window);
            return GLib.SOURCE_REMOVE;
        });

        const languageId = settings.connect('changed::language', build);

        window.connect('close-request', () => {
            settings.disconnect(languageId);
            return false;
        });
    }

    _addAboutButton(window) {
        const headerBar = this._findHeaderBar(window);
        if (!headerBar || headerBar._hasAboutButton)
            return;

        const aboutButton = new Gtk.Button({
            icon_name: 'open-menu-symbolic',
            tooltip_text: 'About',
            valign: Gtk.Align.CENTER,
        });
        aboutButton.add_css_class('flat');
        aboutButton.connect('clicked', () => this._showAbout(window));

        headerBar.pack_end(aboutButton);
        headerBar._hasAboutButton = true;
    }

    _findHeaderBar(widget) {
        if (widget instanceof Adw.HeaderBar)
            return widget;

        for (let child = widget.get_first_child(); child;
            child = child.get_next_sibling()) {
            const headerBar = this._findHeaderBar(child);
            if (headerBar)
                return headerBar;
        }

        return null;
    }

    _showAbout(window) {
        const version = this.metadata['version-name'] ?? (this.metadata.version ? String(this.metadata.version) : '1.0.0');
        const url = this.metadata.url ? this.metadata.url.replace(/\/+$/, '') : 'https://www.binhnguyensoft.com';

        const params = {
            application_name: this.metadata.name || 'Stock Market Widget',
            developer_name: 'Binh Nguyen',
            version: String(version),
            website: 'https://www.binhnguyensoft.com',
            issue_url: `${url}/issues`,
        };

        if (Adw.AboutDialog) {
            const about = new Adw.AboutDialog(params);
            about.present(window);
        } else {
            const about = new Adw.AboutWindow({
                ...params,
                transient_for: window,
                modal: true,
            });
            about.present();
        }
    }
}

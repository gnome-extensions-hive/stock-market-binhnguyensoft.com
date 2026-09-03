import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const PROCESS_TIMEOUT_MS = 20 * 1000;
const MAX_OUTPUT_CHARS = 2 * 1024 * 1024;
const EXTENSION_UUID = 'stock-market@binhnguyensoft.com';
const DEFAULT_X = 15;
const DEFAULT_Y = 15;
const MAX_ROWS = 20;

function makeLabel(text, styleClass, params = {}) {
    const label = new St.Label({
        text,
        style_class: styleClass,
        y_align: Clutter.ActorAlign.CENTER,
        ...params,
    });
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    label.clutter_text.single_line_mode = true;
    return label;
}

function timeTextFromEpoch(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0)
        return null;
    try {
        return GLib.DateTime.new_from_unix_local(Math.trunc(seconds)).format('%H:%M');
    } catch (_) {
        return null;
    }
}

function validFinite(value, absMax = 1e12) {
    if (value === null || value === undefined)
        return null;
    const n = Number(value);
    if (!Number.isFinite(n) || Math.abs(n) > absMax)
        return null;
    return n;
}

function formatNumber(value, symbol) {
    const n = validFinite(value);
    if (n === null)
        return '—';
    const isVnStock = symbol?.endsWith('.VN') && !symbol.startsWith('^');
    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: isVnStock ? 0 : 2,
        maximumFractionDigits: isVnStock ? 0 : 2,
    }).format(n);
}

function formatSigned(value, symbol) {
    const n = validFinite(value);
    if (n === null)
        return '—';
    const base = formatNumber(Math.abs(n), symbol);
    return `${n >= 0 ? '+' : '-'}${base}`;
}

function formatPct(value) {
    const n = validFinite(value, 100000);
    if (n === null)
        return '—';
    return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function validatePayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new Error('Dữ liệu không phải JSON object');
    if (!Array.isArray(data.rows))
        throw new Error('Thiếu danh sách mã');
    if (data.rows.length > MAX_ROWS)
        throw new Error('Số dòng vượt giới hạn an toàn');

    return data.rows.map(row => {
        if (!row || typeof row !== 'object' || Array.isArray(row))
            throw new Error('Dữ liệu không hợp lệ');
        const symbol = String(row.symbol ?? '').slice(0, 32);
        if (!symbol)
            throw new Error('Mã chứng khoán rỗng');
        return {
            symbol,
            price: validFinite(row.price),
            change: validFinite(row.change),
            changePercent: validFinite(row.changePercent, 100000),
        };
    });
}

class SafeCommandRunner {
    constructor() {
        this._proc = null;
        this._cancellable = null;
        this._timeoutId = 0;
        this._serial = 0;
        this._destroyed = false;
    }

    get running() {
        return this._proc !== null;
    }

    async run(argv) {
        if (this._destroyed)
            throw new Error('Runner đã bị hủy');

        this.cancel();
        const serial = ++this._serial;
        const cancellable = new Gio.Cancellable();
        const proc = Gio.Subprocess.new(
            argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        this._proc = proc;
        this._cancellable = cancellable;

        let timedOut = false;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PROCESS_TIMEOUT_MS, () => {
            this._timeoutId = 0;
            if (this._proc === proc && serial === this._serial) {
                timedOut = true;
                cancellable.cancel();
                try { proc.force_exit(); } catch (_) {}
            }
            return GLib.SOURCE_REMOVE;
        });

        try {
            const [stdout, stderr] = await proc.communicate_utf8_async(null, cancellable);
            if (serial !== this._serial || this._destroyed)
                throw new Error('__STOCKS_CANCELLED__');
            if (timedOut)
                throw new Error('Tiến trình lấy giá quá thời gian');

            const out = stdout ?? '';
            const err = stderr ?? '';
            if (out.length > MAX_OUTPUT_CHARS || err.length > MAX_OUTPUT_CHARS)
                throw new Error('Output vượt giới hạn an toàn');

            return {stdout: out, stderr: err, successful: proc.get_successful()};
        } catch (error) {
            if (timedOut)
                throw new Error('Tiến trình lấy giá quá thời gian');
            throw error;
        } finally {
            if (this._timeoutId && serial === this._serial) {
                GLib.Source.remove(this._timeoutId);
                this._timeoutId = 0;
            }
            if (serial === this._serial) {
                this._proc = null;
                this._cancellable = null;
            }
        }
    }

    cancel() {
        ++this._serial;
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._proc) {
            try { this._proc.force_exit(); } catch (_) {}
            this._proc = null;
        }
    }

    destroy() {
        this._destroyed = true;
        this.cancel();
    }
}

const StocksWidget = GObject.registerClass(
class StocksWidget extends St.BoxLayout {
    _init(extension) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'stocks-card',
            reactive: false,
            can_focus: false,
        });

        this._extension = extension;
        this._runner = new SafeCommandRunner();
        this._refreshSourceId = 0;
        this._failureCount = 0;
        this._destroyed = false;
        this._rowActors = [];
        this._monitorsChangedId = 0;

        this._buildUi();
        this._updatePosition();
        Main.layoutManager._backgroundGroup.add_child(this);
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._updatePosition());
        void this._refresh();
    }

    _updatePosition() {
        const monitorIndex = Math.max(0, Main.layoutManager.primaryIndex ?? 0);
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
        this.set_position(workArea.x + DEFAULT_X, workArea.y + DEFAULT_Y);
    }

    _buildUi() {
        this._title = makeLabel('THỊ TRƯỜNG TÀI CHÍNH', 'stocks-title');
        this.add_child(this._title);

        const subtitleRow = new St.BoxLayout({x_expand: true});
        this._subtitle = makeLabel('Yahoo Finance', 'stocks-subtitle', {x_expand: true});
        this._updated = makeLabel('Cập nhật: --:--', 'stocks-subtitle', {
            x_align: Clutter.ActorAlign.END,
        });
        subtitleRow.add_child(this._subtitle);
        subtitleRow.add_child(this._updated);
        this.add_child(subtitleRow);

        this._table = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'stocks-table',
            x_expand: true,
        });
        this.add_child(this._table);

        this._errorText = makeLabel('', 'stocks-error');
        this._errorText.visible = false;
        this.add_child(this._errorText);
    }

    _clearRows() {
        for (const actor of this._rowActors) {
            try { actor.destroy(); } catch (_) {}
        }
        this._rowActors = [];
    }

    _renderRows(rows) {
        this._clearRows();
        for (const row of rows) {
            const line = new St.BoxLayout({
                style_class: 'stocks-row',
                x_expand: true,
            });

            const symbol = makeLabel(row.symbol, 'stocks-symbol', {
                x_expand: true,
            });
            symbol.set_width(88);

            const price = makeLabel(formatNumber(row.price, row.symbol), 'stocks-price', {
                x_align: Clutter.ActorAlign.END,
            });
            price.set_width(82);
            price.clutter_text.set_line_alignment(Pango.Alignment.RIGHT);

            const changeClass = row.change === null
                ? 'stocks-change stocks-neutral'
                : row.change >= 0
                    ? 'stocks-change stocks-up'
                    : 'stocks-change stocks-down';
            const change = makeLabel(formatSigned(row.change, row.symbol), changeClass, {
                x_align: Clutter.ActorAlign.END,
            });
            change.set_width(72);
            change.clutter_text.set_line_alignment(Pango.Alignment.RIGHT);

            const pctClass = row.changePercent === null
                ? 'stocks-pct stocks-neutral'
                : row.changePercent >= 0
                    ? 'stocks-pct stocks-up'
                    : 'stocks-pct stocks-down';
            const pctText = row.changePercent === null
                ? '—'
                : `${formatPct(row.changePercent)} ${row.changePercent >= 0 ? '▲' : '▼'}`;
            const pct = makeLabel(pctText, pctClass, {
                x_align: Clutter.ActorAlign.END,
            });
            pct.set_width(72);
            pct.clutter_text.set_line_alignment(Pango.Alignment.RIGHT);

            line.add_child(symbol);
            line.add_child(price);
            line.add_child(change);
            line.add_child(pct);
            this._table.add_child(line);
            this._rowActors.push(line);
        }

        if (rows.length === 0) {
            const empty = makeLabel('Chưa có dữ liệu giá.', 'stocks-subtitle');
            this._table.add_child(empty);
            this._rowActors.push(empty);
        }
    }

    _showError(message) {
        this._errorText.text = message ?? '';
        this._errorText.visible = Boolean(message);
    }

    _scheduleNext(delayMs) {
        if (this._destroyed)
            return;
        if (this._refreshSourceId) {
            GLib.Source.remove(this._refreshSourceId);
            this._refreshSourceId = 0;
        }
        this._refreshSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            this._refreshSourceId = 0;
            try { void this._refresh(); }
            catch (error) {
                console.error(`Extension: ${EXTENSION_UUID}: timer failed: ${error}`);
                this._scheduleFailure();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _scheduleFailure() {
        this._failureCount = Math.min(this._failureCount + 1, 8);
        const factor = 2 ** Math.max(0, this._failureCount - 1);
        this._scheduleNext(Math.min(REFRESH_INTERVAL_MS * factor, MAX_BACKOFF_MS));
    }

    async _refresh() {
        if (this._destroyed || this._runner.running)
            return;

        if (this._refreshSourceId) {
            GLib.Source.remove(this._refreshSourceId);
            this._refreshSourceId = 0;
        }

        try {
            const script = GLib.build_filenamev([this._extension.path, 'stocks_fetch.py']);
            const result = await this._runner.run(['python3', '-B', script]);
            if (this._destroyed)
                return;

            let data;
            const raw = result.stdout.trim();
            try {
                data = JSON.parse(raw);
            } catch (error) {
                throw new Error(raw || result.stderr.trim() || `JSON lỗi: ${error.message}`);
            }
            if (data.error)
                throw new Error(String(data.error).slice(0, 500));
            if (!result.successful)
                throw new Error(result.stderr.trim() || 'Tiến trình lấy giá thất bại');

            const rows = validatePayload(data);
            this._renderRows(rows);

            const liveCount = Number.isFinite(Number(data.liveCount))
                ? Math.max(0, Number(data.liveCount))
                : rows.length;
            const updatedText = timeTextFromEpoch(data.updatedAt);
            if (updatedText)
                this._updated.text = `Cập nhật: ${updatedText}`;

            const warning = data.warning ? String(data.warning).slice(0, 220) : '';
            this._showError(warning || null);

            if (liveCount > 0) {
                this._failureCount = 0;
                this._scheduleNext(REFRESH_INTERVAL_MS);
            } else {
                this._scheduleFailure();
            }
        } catch (error) {
            if (this._destroyed)
                return;
            if (error.message === '__STOCKS_CANCELLED__' ||
                error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;

            // Preserve the last valid market data instead of clearing the UI.
            const message = String(error.message || error).slice(0, 500);
            this._showError(`Không cập nhật được · ${message}`);
            console.error(`Extension: ${EXTENSION_UUID}: refresh failed: ${error}`);
            this._scheduleFailure();
        }
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._runner?.destroy();
        this._runner = null;
        if (this._refreshSourceId) {
            GLib.Source.remove(this._refreshSourceId);
            this._refreshSourceId = 0;
        }
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        this._clearRows();
        super.destroy();
    }
});

export default class FinancialMarketsExtension extends Extension {
    enable() {
        try {
            this._widget = new StocksWidget(this);
        } catch (error) {
            console.error(`Extension: ${EXTENSION_UUID}: enable failed: ${error}`);
            try { this._widget?.destroy(); } catch (_) {}
            this._widget = null;
        }
    }

    disable() {
        try {
            this._widget?.destroy();
        } catch (error) {
            console.error(`Extension: ${EXTENSION_UUID}: disable cleanup failed: ${error}`);
        } finally {
            this._widget = null;
        }
    }
}

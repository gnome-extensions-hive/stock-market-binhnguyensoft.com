# stock-market@binhnguyensoft.com
Widget hiển thị bảng giá các mã chứng khoán, tiền số,... từ Yahoo Finance trên Desktop cho GNOME Shell

## Screenshot

![Screenshot](stock-market.webp)

## Giới thiệu

Linux Desktop Widget GNOME Shell cho bạn nào quan tâm các mã chứng khoán trong nước và thế giới, cũng như các mã tiền số, các chỉ số chứng khoán thế giới,... Dữ liệu hiển thị bao gồm:

- Giá/điểm chỉ số hiện tại
- Tăng giảm so với trước đó
- Phần trăm tăng giảm
- Dữ liệu cập nhật 10 phút/lần

Widget này được phát triển dựa trên widget Stocks (Übersicht cho macOS) của tác giả Dion Munk tại [https://github.com/dionmunk/uebersicht-stocks](https://github.com/dionmunk/uebersicht-stocks).

## Yêu cầu

Dùng cho Linux GNOME 45 trở lên.

Máy cần có Python và curl. Kiểm tra xem đã được cài chưa bằng:

```bash
python3 --version
command -v curl
curl --version
```

Nếu chưa có curl, cài bằng:

```bash
sudo apt update
sudo apt install curl
```

## Cài đặt

Bạn có thể cài Extension Manager để dễ thao tác bằng giao diện.

Download repository, giải nén, đổi tên thư mục thành `stock-market@binhnguyensoft.com` rồi mở **Terminal** chạy lệnh:

```bash
gnome-extensions install --force stock-market@binhnguyensoft.com
```

Hoặc giải nén rồi copy thư mục `stock-market@binhnguyensoft.com` vào `~/.local/share/gnome-shell/extensions`.

Nếu extension không hiển thị, hãy logout rồi login lại, sau đó, bật bằng giao diện hoặc chạy lệnh:

```bash
gnome-extensions enable stock-market@binhnguyensoft.com
```

## Tùy chỉnh / Preferences

Biên dịch schema sau khi tải hoặc cập nhật mã nguồn:

```bash
glib-compile-schemas schemas/
```

Mở cấu hình bằng Extension Manager hoặc:

```bash
gnome-extensions prefs stock-market@binhnguyensoft.com
```

- **Vị trí:** Trái/Trên tính bằng pixel từ góc trên trái thật của màn hình chính, không cộng chiều cao thanh menu. Đặt cả hai bằng 0 để dùng đúng gốc màn hình; thanh menu có thể che phần trên của widget. Mặc định: 15/15 px.
- **Chu kỳ cập nhật:** 5–300 phút, mặc định 10 phút. Khi có lỗi, widget tự tăng thời gian thử lại.
- **Mã theo dõi:** nhập các symbols Yahoo Finance, phân cách bằng dấu phẩy hoặc khoảng trắng, rồi nhấn nút áp dụng. Tối đa 20 mã. Xóa mã khỏi ô để bỏ theo dõi; xóa hết để tạm dừng yêu cầu mạng.
- **Ngôn ngữ:** Theo hệ thống, English hoặc Tiếng Việt. Thay đổi áp dụng ngay cho widget và cửa sổ cấu hình.

### English

Compile settings with `glib-compile-schemas schemas/` after downloading or updating the source, then open Preferences using Extension Manager or the command above.

- **Position:** Left/Top are pixels from the primary monitor’s actual top-left corner, without a panel offset. Set both to zero for the screen origin; the top panel may cover that part of the widget. Defaults: 15/15 px.
- **Update interval:** 5–300 minutes, default 10. Failed updates use exponential retry delays.
- **Symbols:** enter up to 20 Yahoo Finance symbols separated by commas or spaces, then click Apply. Remove entries to stop tracking them. An empty list pauses network requests.
- **Language:** System default, English, or Vietnamese; changes apply immediately.

## Credit

Widget này được phát triển dựa trên widget Stocks (Übersicht cho macOS) của tác giả Dion Munk tại [https://github.com/dionmunk/uebersicht-stocks](https://github.com/dionmunk/uebersicht-stocks)].

Tác giả Dion Munk yêu cầu giấy phép [Creative Commons Attribution-NonCommercial 4.0 International License](https://creativecommons.org/licenses/by-nc/4.0/).

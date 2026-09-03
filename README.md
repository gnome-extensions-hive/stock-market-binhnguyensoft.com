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

Download repository rồi mở **Terminal** chạy lệnh:

```bash
gnome-extensions install --force stock-market@binhnguyensoft.com
```

Hoặc giải nén rồi copy thư mục `stock-market@binhnguyensoft.com` vào `~/.local/share/gnome-shell/extensions`.

Nếu extension không hiển thị, hãy logout rồi login lại, sau đó, bật bằng giao diện hoặc chạy lệnh:

```bash
gnome-extensions enable stock-market@binhnguyensoft.com
```

## Tùy chỉnh

Mặc định, dữ liệu cập nhật 10 phút một lần, vị trí xuất hiện widget: trên 15px, trái 15px. Nếu muốn thay đổi, sửa file `extension.js` trong thư mục `~/.local/share/gnome-shell/extensions/stock-market@binhnguyensoft.com` như sau:

### Tần suất cập nhật 

Thay 10 bằng số khác. KHUYÊN CÁO: KHÔNG nên cập nhật quá thường xuyên để tránh trường hợp server Yahoo chặn.

```js
const REFRESH_INTERVAL = 10 * 60 * 1000;
```

### Vị trí

Việc lập trình kéo thả widget quá phức tạp nên mình đặt vị trí cố định. Sửa hai dòng sau nếu bạn muốn thay đổi:

```js
const DEFAULT_X = 15;
const DEFAULT_Y = 15;
```

## Thay đổi mã theo dõi

Sửa file `stocks_fetch.py` trong thư mục `~/.local/share/gnome-shell/extensions/stock-market@binhnguyensoft.com`. Tại dòng sau ở đầu file:

```python3
# Các mã cần xem
SYMBOLS = [
    "GC=F", "BZ=F", "CL=F", "DX-Y.NYB", "BTC-USD",
    "^DJI", "^GSPC", "^VNINDEX.VN", "MBB.VN", "VCB.VN", "SSI.VN",
]
```

Để xác định mã của cổ phiếu hay chỉ số, vào [https://finance.yahoo.com/](https://finance.yahoo.com/). Trong ô Search của trang, tìm mã mong muốn, rồi mở nó ra, ngay trên title, bạn sẽ thấy mã cần xem, ví dụ: Bitcoin USD Price (BTC-USD) thì BTC-USD là mã cần copy vào code.

## Credit

Widget này được phát triển dựa trên widget Stocks (Übersicht cho macOS) của tác giả Dion Munk tại [https://github.com/dionmunk/uebersicht-stocks](https://github.com/dionmunk/uebersicht-stocks)].

Tác giả Dion Munk yêu cầu giấy phép [https://creativecommons.org/licenses/by-nc/4.0/]('Creative Commons Attribution-NonCommercial 4.0 International License').

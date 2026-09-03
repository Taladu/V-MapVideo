# V29 SAFE SATELLITE LAYER

- Thêm nút 🛰️ để chuyển **Bản đồ thường ↔ Vệ tinh**.
- Không dùng `map.setStyle()`: toàn bộ source/layer V28 vẫn còn nguyên.
- Chế độ vệ tinh chỉ bật/tắt `visibility` của một raster layer độc lập.
- Mapbox Standard dùng slot `bottom`; style cổ điển đặt ảnh ngay dưới lớp nhãn chữ.
- Vệt chỉ đường, GPS-video, POI, popup, định vị và 2D/3D nằm phía trên ảnh vệ tinh.
- Logic A→B/B→A và toàn bộ dữ liệu GPS-video không thay đổi.

## Cấu hình Mapbox an toàn cho bản lấy từ GitHub

Bản V29 hoàn chỉnh không còn yêu cầu tự tạo `mapbox-token.js`.

1. Mở V-Map bằng VS Code + Live Server.
2. Lần đầu chạy, V-Map tự hiện hộp **Cấu hình Mapbox lần đầu**.
3. Dán public token Mapbox bắt đầu bằng `pk.` rồi bấm **Lưu & mở V-Map**.
4. Token chỉ được lưu trong `localStorage` của trình duyệt trên máy đang dùng, không được ghi vào source code và không được commit lên GitHub.
5. Khi triển khai thật, giới hạn token theo đúng domain V-MapVideo trong tài khoản Mapbox.

Nếu cần xóa token đã lưu để nhập lại, mở Console và chạy:

```js
window.VMAP_MAPBOX_TOKEN_RUNTIME.clear();
location.reload();
```

`mapbox-token.js` vẫn nằm trong `.gitignore` để tránh commit nhầm nếu sau này dùng cấu hình local/deployment riêng.

# NÂNG CẤP 1.3.2 — “Xem từ đây → điểm B”

Bản này nâng an toàn từ 1.3.1:

- Popup trên vệt đường hiển thị rõ **“Xem từ đây → [đích]”**.
- Video vẫn bắt đầu đúng timestamp GPS tại vị trí người dùng bấm.
- Thêm `destinationName` trong dữ liệu route để xác nhận đích thật của video.
- Nếu route chưa có `destinationName`, giao diện có cảnh báo: tên điểm B chỉ là nhãn giao diện, chưa phải bằng chứng video thật sự đi tới B.
- Fallback YouTube không còn gây hiểu nhầm là video hướng dẫn đến B.
- Giữ nguyên hotfix 1.3.1: click vệt đường không dời điểm A/B.
- Giữ nguyên GPS Timeline và xử lý cắt đèn đỏ.

## Khuyến nghị dữ liệu

Mỗi video thật nên khai báo:

```json
{
  "name": "Bến Thành → Tân Sơn Nhất",
  "destinationName": "Sân bay Tân Sơn Nhất",
  "youtube": "VIDEO_ID",
  "points": []
}
```

Khi có nhiều video/tuyến, `destinationName` là nền tảng để bước sau lọc đúng video theo điểm B thay vì chỉ chọn tuyến GPS gần nhất.

# HOTFIX 1.3.1 — Click tuyến đường

Bản này sửa lỗi khi bấm vào vệt chỉ đường thì Mapbox Directions tự dời điểm B đến vị trí vừa bấm.

- `interactive: false` cho MapboxDirections để click trên bản đồ không tự thay A/B.
- Bắt click trên mọi layer có id bắt đầu bằng `directions-route`, không phụ thuộc một tên layer cố định.
- Khi đã có GPS-video: mở đúng video/timestamp.
- Khi chưa có GPS-video thật: vẫn hiện popup với liên kết kênh YouTube để kiểm tra thao tác click.
- Toàn bộ logic GPS Timeline 1.3 giữ nguyên.

# V-MapVideo CLEAN 1.3 — GPS Timeline

Bản 1.3 nâng trực tiếp từ CLEAN 1.2, giữ nguyên Mapbox, Directions, flycam, 2D/3D, GPS người dùng, places.json, âm thanh và UI chính.

## Điểm mới quan trọng

- GPS dùng `tRaw`: thời gian gốc kể từ lúc bắt đầu quay.
- `timelineEdits`: khai báo các đoạn hậu kỳ bị rút ngắn, ví dụ đèn đỏ 100 giây giữ lại 3 giây.
- V-Map tự đổi `tRaw` sang thời gian video thành phẩm khi người dùng bấm vệt đường.
- Không phải sửa thủ công toàn bộ mốc GPS phía sau một đoạn cắt.
- Nếu nhiều tuyến/hai chiều trùng nhau, V-Map cho người dùng chọn đúng hướng thay vì đoán.
- Popup có link mở đúng timestamp trên YouTube.
- Có `gps-timeline-tool.html` để nhập GPX/CSV/JSON và xuất `route-videos.json`.

## Ví dụ timelineEdits

```json
"timelineEdits": [
  {"start": 600, "end": 700, "keepSeconds": 3, "label": "Đèn đỏ"}
]
```

Nếu một điểm GPS gốc ở giây 800, sau đoạn trên nó sẽ phát ở giây 703 của video thành phẩm.

## Quy trình thực tế

1. Quay liên tục bằng Action 4 + GPS Remote.
2. Hậu kỳ rút các đoạn chờ dài; ghi lại start/end/keep.
3. Mở `gps-timeline-tool.html` bằng Live Server.
4. Nạp track GPX/CSV/JSON.
5. Nhập các đoạn hậu kỳ.
6. Xuất `route-videos.json`.
7. Gắn YouTube video ID và kiểm tra bằng cách bấm vệt đường.

## Lưu ý về DJI

Công cụ 1.3 chưa tự giải mã telemetry trực tiếp từ MP4 DJI. Nếu dữ liệu GPS nằm trong telemetry MP4, cần trích ra GPX/CSV/JSON trước. Khi có một file MP4 gốc thật, có thể xây bước trích telemetry riêng sau.

## Chạy

Mở nguyên thư mục bằng VS Code + Live Server. Không dùng `file://` vì trình duyệt có thể chặn fetch JSON.

## Production

Mapbox public token vẫn ở client như bản 1.2. Khi public chính thức, giới hạn token theo domain/app.

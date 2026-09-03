# V29.3 SAFE SATELLITE PRELOAD

V29.3 nâng an toàn từ V29.2 sau khi test thực tế cho thấy hai vấn đề: 3D Standard chưa ẩn hết trên GL JS 3.4.0 và raster vệ tinh có thể nạp thành mảng ngay sau khi bật/xoay.

## Thay đổi V29.3

- Nâng Mapbox GL JS từ `3.4.0` lên `3.29.0`; Mapbox Directions vẫn giữ nguyên `4.1.1`.
- Không dùng `map.setStyle()`: style V-Map hiện tại, Directions, GPS-video và POI không bị tháo ra rồi gắn lại.
- Raster `mapbox://mapbox.satellite` được giữ **visible với opacity 0.0001** khi đang ở bản đồ thường để Mapbox có thể chuẩn bị tile trước.
- Khi bật 🛰️, chỉ đổi raster opacity lên `1`; khi tắt hạ về `0.0001`, không dùng `visibility:none`.
- Với Standard import, V29.3 tắt 3D objects/buildings/trees/landmarks/facades và giảm nhãn POI/transit/place trong chế độ vệ tinh.
- Giữ nhãn đường để định hướng.
- Lớp `3d-buildings` tùy chỉnh của V-Map cũng được ẩn khi bật vệ tinh và khôi phục đúng opacity cũ khi tắt.
- Nếu bấm 2D/3D trong lúc đang ở vệ tinh, trạng thái 3D mới được ghi nhớ nhưng vẫn bị ẩn trên ảnh vệ tinh; quay về bản đồ thường sẽ phục hồi trạng thái đó.
- Không thay đổi logic A→B/B→A, GPS matcher/resolver, hit layer, popup, POI, dữ liệu video hay tọa độ tuyến.

## Bảo vệ hồi quy V29.3

GitHub Actions khóa hash của các file lõi V29.2 để V29.3 không vô tình sửa:
- `script.js`
- `gps-route-overlay.js`
- `gps-video-library.js`
- `vmap-runtime-bridge.js`
- `exact-ab-reverse-regression.test.cjs`

Ngoài ra vẫn chạy Golden V19 data hashes, exact A/B reverse, V28 geometry/hit-layer/library tests, token safety và satellite regression.

## Cấu hình Mapbox an toàn

Token vẫn dùng cơ chế cấu hình lần đầu và lưu cục bộ trong `localStorage`; token thật không được commit lên GitHub.

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

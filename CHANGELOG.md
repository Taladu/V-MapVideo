# CHANGELOG

## V29 SAFE SATELLITE LAYER
- Thêm nút chuyển Bản đồ thường/Vệ tinh cạnh nút 3D.
- Thêm `satellite-layer-toggle.js` độc lập; không sửa resolver GPS-video V28.
- Không gọi `map.setStyle()`, không remove source/layer và không dựng lại Directions.
- Chỉ đổi `visibility` của raster `mapbox.satellite`.
- Giữ ảnh vệ tinh dưới đường/nhãn/POI/vệt GPS bằng slot hoặc label anchor phù hợp style.
- Thêm kiểm thử hồi quy khóa cơ chế không phá layer.
- Bản nguồn GitHub bỏ token Mapbox khỏi `script.js` và trang GPS test.
- Token runtime chuyển sang `mapbox-token.js` bị `.gitignore`; có tệp mẫu không chứa khóa thật.
- Khi thiếu token, ứng dụng dừng khởi tạo an toàn và hiển thị hướng dẫn thay vì lỗi dây chuyền.

## V28 SAFE DUAL GEOMETRY
- Dựng trực tiếp từ V19 field-proven, không từ V27/V28 cũ.
- Giữ nguyên resolver V19 và ngưỡng 180 m / 120 m / 70°.
- Tách `fullRouteCoords` (authority toàn tuyến) và `localRouteCoords` (bearing tại click); hai state không ghi đè nhau.
- Hit-layer GPS-video 20 px trong suốt; Directions và GPS hit-layer được query riêng.
- Nếu click hit GPS nhưng không hit đúng pixel Directions, query box 6 px lấy local Directions context.
- GPS telemetry gap >180 m, >30 s hoặc time reverse chỉ tách vệt hiển thị; không tạo safeStart/safeEnd và không cắt coverage lân cận.
- Source priority được sắp trước duplicate-ID filtering.
- Structured diagnostics cho PLAY/NO_VIDEO và shadow so full-route bearing với local bearing.
- Không đưa lại `fixedCoverageAt`, `safeStart`, `safeEnd`, `advanceOK` hoặc fixed interval.

## 1.3.2
- Popup “Xem từ đây → [đích]”.
- Thêm metadata `destinationName`.
- Phân biệt rõ video đã xác nhận đích và fallback YouTube.
- Giữ nguyên chống dời A/B và GPS Timeline.

## 1.3.1
- Sửa click vệt đường làm dời điểm B.
- Tắt mouse/touch interactivity mặc định của Mapbox Directions trên bản đồ.
- Bắt tất cả layer `directions-route*`.
- Thêm YouTube fallback khi chưa có dữ liệu GPS-video thật.

## 1.3
- `tRaw` cho GPS thời gian gốc.
- `timelineEdits` cho đoạn cắt/rút đèn đỏ.
- Tự ánh xạ raw time → final video time.
- Hỗ trợ chọn tuyến khi GPS của nhiều tuyến/hai chiều trùng nhau.
- Link YouTube đúng timestamp.
- Kiểm tra route data.
- Công cụ GPX/CSV/JSON → `route-videos.json`.
- Giữ các chức năng 1.2.

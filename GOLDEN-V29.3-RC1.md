# V29.3 GOLDEN RC1

Đây là mốc giao diện chuẩn của V-MapVideo trước khi tiếp tục hardening hoặc phát triển tính năng.

## Style Mapbox chuẩn bắt buộc

`mapbox://styles/taladu/cml928jj3004c01s95ns59gwa`

Style này là bộ mặt V-MapVideo hiện tại: sông, đường, đại lộ, nhãn và bố cục nền mà chủ dự án đã nghiệm thu trực quan.

## Khóa kỹ thuật

- Mapbox GL JS: `3.29.0`
- Mapbox Directions: `4.1.1`
- Không được thay style bằng `mapbox://styles/mapbox/...`
- Không được dùng `map.setStyle()` cho nút vệ tinh.
- GPS-video/A↔B/POI/popup phải giữ nguyên các regression test hiện có.
- `v29.3-golden-style.test.cjs` khiến CI FAIL nếu style chuẩn bị thay đổi ngoài ý muốn.

## Quy tắc phát triển sau RC1

Mọi nâng cấp bảo mật hoặc tính năng phải làm trên nhánh mới từ Golden, test xong mới cân nhắc nhập lại. Nhánh Golden không dùng để thử nghiệm trực tiếp.

# V29.3 SECURITY HARDENING

Nhánh này tách trực tiếp từ `v29.3-golden-rc1`. Không sửa bản Golden.

## Đã harden trong code

- Escape `place.name` trước khi đưa vào popup HTML.
- Escape `place.name` trong thuộc tính `alt`.
- Escape `category` trước khi đưa vào tiêu đề nhóm.
- Escape tên POI trong danh sách địa điểm.
- Có regression test `v29.3-poi-xss.test.cjs`.
- Vẫn chạy Golden style lock, GPS/A↔B regression và token safety.

## Việc ngoài code vẫn cần làm trước production

- Revoke public Mapbox token cũ từng xuất hiện trên `main`.
- Giới hạn public token mới theo domain V-MapVideo khi có domain thật.
- Bật GitHub branch protection/ruleset cho `main`: yêu cầu PR + CI PASS, chặn force-push.
- Duplicate style Mapbox hiện tại thành bản backup Golden trong Mapbox Studio.
- Khi có hosting thật, cấu hình CSP và các security headers tại server/CDN rồi test Mapbox/YouTube.

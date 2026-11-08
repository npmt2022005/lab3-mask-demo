# Lab 3 — triển khai Render Free

> **Nhánh thử YOLOv8n 416 fine-tune:** giảm lỗi che mặt và thích nghi phiên webcam, nhưng test cảnh chung giảm từ 75,04% xuống 74,44%. Chưa đề nghị thay main. Xem [báo cáo, số đo và giới hạn](reports/NANO_FINETUNE_20261109.md). Dockerfile của nhánh này tải bản fine-tune từ `model_yolo_nano`.

Đây là gói triển khai riêng. Dockerfile đang dùng YOLOv8n 416 (`model_yolo_nano`) để chạy liên tục trên CPU miễn phí; muốn dùng lại YOLOv8s 640, đổi `model_yolo_nano` thành `model_yolo` ở cả hai dòng COPY và ENV trong Dockerfile. Chỉ có code phục vụ web/API, ONNX và metadata, không có ảnh webcam cá nhân, dataset, firmware hay mật khẩu.

## Đưa lên Render

1. Dùng Git hoặc GitHub Desktop để đưa **nội dung bên trong thư mục này** vào một repository GitHub mới. Không upload toàn bộ dự án Lab3 cũ hoặc file ZIP. Model ONNX khoảng 13 MB nên không dùng cách kéo file lên website GitHub; dùng Git/GitHub Desktop. Ở gốc repo phải có Dockerfile, package.json, package-lock.json và các thư mục public, model_yolo.
2. Đăng nhập https://dashboard.render.com, chọn **New → Web Service**, kết nối repo.
3. Chọn runtime **Docker**, compute plan **Free**, một instance. Không chọn Static Site. Không cần nhập Build Command/Start Command của Node vì Dockerfile đã định nghĩa.
4. Đặt Health Check Path là `/health`. Dockerfile đã đặt EXECUTION_LOCATION=cloud, MODEL_BACKEND=yolo và ORT_NUM_THREADS=1. Không cần tự đặt PORT; ứng dụng đọc PORT do nền tảng cung cấp.
5. Create Web Service, đợi build/deploy. Kiểm tra trang `<URL>/health`: ready=true và execution_location=cloud, architecture=YOLOv8n fine-tuned mask detector (416).
6. Mở URL HTTPS do Render cấp bằng Chrome/Edge. Trong phần kết nối API dùng đúng URL của dịch vụ đó. Cho phép webcam, ưu tiên **Nhận diện 1 ảnh** thay vì chạy liên tục.

Có render.yaml để dùng Blueprint nếu muốn; vẫn kiểm tra gói Free trên màn hình tạo dịch vụ trước khi triển khai.

## Miễn phí và hiệu năng

Render Free có 0,1 CPU, 512 MB RAM; dịch vụ ngủ sau 15 phút không có yêu cầu, lần gọi sau có thể mất khoảng một phút để khởi động. Có hạn mức giờ chạy, build và băng thông. Xem https://render.com/docs/free và https://render.com/docs/compute-plans. Không bật nâng cấp trả phí tự động.

Model đã dùng đỉnh khoảng 283 MB trong một phép đo process Windows 10 ảnh; đó không phải số đo full dịch vụ Render/Linux và không bảo đảm tránh thiếu RAM. Gói đã giới hạn ONNX 1 luồng, Sharp 1 luồng, cache ảnh 16 MB; backend xử lý một yêu cầu cùng lúc. CPU miễn phí yếu nên không kỳ vọng video nhận diện mượt. Không giảm kích thước đầu vào ONNX hoặc thay model để giả định giữ nguyên độ chính xác.

Nếu thiếu RAM hoặc quá chậm: xem log, giảm lượng ảnh gửi, thử model nano đã có và đánh giá lại chất lượng riêng; không tự nâng lên gói trả phí. Nếu cần webcam mượt như máy local, gói Free này khó đáp ứng.

## Đo cho báo cáo

Thử 3–5 ảnh khởi động, tách riêng thời gian khởi động nguội khỏi số đo ổn định. Sau đó đo tối thiểu 30 lượt trên cùng các ảnh cho local và Cloud; xuất CSV thời gian. Báo trung bình, p95 cho suy luận, gửi–nhận và toàn trình. CPU Cloud chậm hơn không có nghĩa model nhận sai hơn; nếu timeout/bỏ lượt cần thống kê riêng.

Chưa triển khai lên tài khoản Render; gói này mới được chuẩn bị và kiểm tra API tại máy local. Docker daemon trên máy hiện chưa chạy nên chưa kiểm thử container Linux giới hạn 512 MB. Cần xem log và đo trên Render sau deploy mới xác nhận chạy ổn.

Model/phần mềm liên quan Ultralytics sử dụng AGPL-3.0; LICENSE đi kèm model. Giữ thông tin nguồn và giấy phép khi chia sẻ.

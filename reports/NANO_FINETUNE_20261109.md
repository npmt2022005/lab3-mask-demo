# YOLOv8n 416 fine-tune — 09/11/2026

**Cập nhật triển khai:** sau khi xem kết quả, người dùng yêu cầu merge và deploy, đồng thời thêm lựa chọn Nano/Small. App mặc định nano fine-tune và cho chọn small 640. Các đoạn quyết định giữ main bên dưới là kết luận ban đầu trước yêu cầu này; số đo không thay đổi, `retention_passed=false` vẫn được giữ để phản ánh đánh đổi thực tế.

Fine-tune đã hoàn thành trên RTX 3060, dừng sớm sau **15/20 epoch**. Bắt đầu từ nano đã học khẩu trang, không dùng checkpoint small. Input 416×416, batch8, freeze0, AMP, AdamW lr0=0,00005, warmup1/biaslr0, seed2026, patience6. Chọn checkpoint bằng validation fitness và confidence **0,25** bằng validation, không đổi ngưỡng sau khi xem test.

Bộ train kết hợp giữ ba nhãn: cảnh khẩu trang cũ, HOF và 9 ảnh đại diện từ phiên 42 ảnh webcam, mỗi đại diện lặp 4 lần. Tổng 1.054 mục train. Toàn bộ 42 ảnh do người dùng xác nhận là Incorrect mask (class2); không tự đổi nhãn sang đeo đúng. Ảnh cá nhân và dataset không được đẩy lên repo.

| Phép đo | Nano trước fine-tune | Nano sau fine-tune |
|---|---:|---:|
| Test cảnh cũ: đúng hộp IoU≥0,5 và nhãn | 502/669 = 75,04% | 498/669 = 74,44% |
| Macro F1 ba lớp trên test cảnh | 63,85% | 62,67% |
| HOF test: đúng hộp và No mask | 24/38 | 35/38 |
| HOF test: ảnh bị báo Mask gần mặt chính | 4/38 | 0/38 |
| Phiên webcam: đúng hộp và Incorrect mask | 7/42 | 40/42 |

Trên cảnh cũ: Mask đúng 427 xuống 423/537; No mask 69 lên 70/118; Incorrect mask 6 xuống 5/14. Lớp đeo sai công khai chỉ có 14 mặt, chưa đủ để khẳng định cải thiện ngoài phiên webcam.

**40/42 không phải độ chính xác webcam độc lập**: 9 ảnh đại diện đã tham gia train, các ảnh còn lại cùng người/bối cảnh và nhiều ảnh gần trùng. Hai ảnh có dự đoán đeo sai nhưng hộp chưa khớp IoU0,5. HOF là bộ thử thách chọn lọc với hộp YuNet được trợ lý kiểm tra, không phải benchmark camera tự nhiên. Bộ test cảnh đã được dùng trong phát triển trước đây.

Validation cảnh tăng đúng hộp và nhãn từ 71,90% lên 73,39%, HOF validation nhận đúng No mask 32/32. Tuy nhiên test cảnh giảm nhẹ 4 mặt và macro F1 giảm; điều kiện giữ chất lượng chung đã đặt ra **chưa đạt**. Vì vậy bản này được đưa lên **nhánh thử và PR**, không tự thay main/model chính.

ONNX CPU local trong lượt test trung bình khoảng44ms, p9566ms; có các kiểm tra khác chạy đồng thời, không dùng để kết luận chậm/nhanh hơn baseline hay cam kết tốc độ Cloud. Đã qua kiểm tra trình duyệt bằng webcam giả lập: upload, nhiều mặt, camera, chụp ảnh gốc, dừng, giải phóng track, CSV/JPEG, mobile và API recovery. Không tự bật webcam vật lý.

Model chính vẫn là nano trước fine-tune. Muốn quyết định thay cần thử một phiên webcam mới có cả ba trạng thái, đặc biệt đeo đúng, và xem đánh đổi giữa lỗi che mặt với test cảnh chung. Model fine-tune giữ tại `model_yolo_nano_finetuned` ở thư mục làm việc; trên nhánh thử repo đặt tại `model_yolo_nano` để tương thích Dockerfile hiện có.

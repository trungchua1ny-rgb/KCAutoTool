export type AppPage =
  | "home"
  | "sessions"
  | "voice"
  | "screenplay"
  | "visual-bible"
  | "characters"
  | "timeline"
  | "edit"
  | "queue"
  | "output"
  | "settings";

export const PAGE_COPY: Record<AppPage, { title: string; description: string }> = {
  home: { title: "Trang chủ", description: "Theo dõi toàn bộ dây chuyền sản xuất video AI." },
  sessions: { title: "Phiên làm việc", description: "Mở, đổi tên và quản lý dữ liệu từng dự án." },
  voice: { title: "Voice Studio", description: "Tạo voice Microsoft Edge TTS và phụ đề SRT đồng bộ." },
  screenplay: { title: "Screenplay Studio", description: "Chuẩn bị kịch bản hình, thoại nhân vật, ambience và hiệu ứng âm thanh." },
  "visual-bible": { title: "Visual Bible", description: "Khóa phong cách, màu sắc, ánh sáng và tính liên tục." },
  characters: { title: "Nhân vật", description: "Quản lý ảnh tham chiếu và nametag nhân vật." },
  timeline: { title: "Timeline & Prompt", description: "Quản lý scene, prompt ảnh/video và chuỗi single/start/continue." },
  edit: { title: "Dựng CapCut", description: "Xếp toàn bộ video scene và âm thanh phù hợp với loại phiên vào project CapCut." },
  queue: { title: "Production Queue", description: "Điều phối tuần tự ảnh, video và frame nối tiếp." },
  output: { title: "Xuất dữ liệu", description: "Kiểm tra audio, SRT, ảnh, video và frame đã tạo." },
  settings: { title: "Cài đặt", description: "Kiểm tra kết nối worker và trạng thái hệ thống." },
};

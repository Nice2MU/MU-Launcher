# MU Launcher Workspace

ชุดเครื่องมือสำหรับจัดการและสร้างแอนิเมชันตัวละคร 2D บน macOS ประกอบด้วย 2 โปรเจคหลักในที่เดียว:

1. **MU Launcher** (`launcher/`) — ตัวจัดการและเปิด-ปิดแอปในสตูดิโอ พร้อมเช็คสถานะการทำงานแบบเรียลไทม์
2. **MURig v1.0.1** (`MURig/`) — โปรแกรมทำ 2D Character Rigging, Mesh Skinning และ Animation พร้อมระบบ Export สำหรับเกม (Unity)

---

## โครงสร้างโฟลเดอร์

```text
MU Launcher/
├── launcher/        # ซอร์สโค้ด MU Launcher (React + Vite + Tauri)
├── MURig/           # ซอร์สโค้ด MURig 2D Rigging Studio (React + PixiJS + Tauri)
├── .gitignore       # กรอง node_modules, dist, target และ .app ออกจาก Git
└── README.md
```

---

## 1. MU Launcher

- สแกนหาแอป `.app` ภายในโฟลเดอร์ `MU Launcher` อัตโนมัติ
- แสดงสถานะ **Running / Offline** ของแต่ละแอป และสั่ง **Launch / Quit** ได้จากหน้าเดียว
- ปักหมุด (Pin) และจัดหมวดหมู่แอปที่ใช้งานบ่อยได้

---

## 2. MURig (v1.0.1)

โปรแกรม Rig ตัวละคร 2D จากไฟล์ Photoshop (`.psd`):

- **Import & Update PSD:** นำเข้าตัวละครจากไฟล์ `.psd` โดยแยกเลเยอร์อัตโนมัติ และอัปเดตภาพจาก `.psd` ใหม่ได้โดยยังรักษากระดูก (Bones), Mesh Weights และ Animation เดิมไว้
- **Bone & Skinning:** สร้างโครงกระดูก, ผูกชิ้นส่วน (Part / Group), ระบายน้ำหนักจุดกริด 32×32 (Weight Brush) และตั้งค่า Parallax / Eye Tilt
- **Animation Timeline:** ทำคีย์เฟรม, พรีเซ็ตท่าทาง และพรีวิวแอนิเมชันแบบ 60fps
- **Export (`Cmd/Ctrl + E`):** แพ็กชิ้นส่วนที่เลือกเป็น **Texture Atlas** ขนาดพิกเซลต้นฉบับ 1:1 ออกมาเป็น 3 ไฟล์พร้อมใช้:
  - `<Name>.png` — แผ่น Texture Atlas รวม
  - `<Name>.atlas` — พิกัด Region มาตรฐาน
  - `<Name>.rig.json` — ข้อมูล Bones, UV, Mesh Weights และ Animation Clips

---

## วิธีรันหรือ Build ใช้งาน (macOS)

ต้องมี **Node.js** และ **Rust (`cargo`)** ติดตั้งไว้ก่อน

### รันโหมดพัฒนา (Dev)
```bash
# MU Launcher
cd launcher && npm install && npm run tauri dev

# MURig
cd MURig && npm install && npm run tauri dev
```

### คอมไพล์เป็นไฟล์ `.app`
```bash
# MU Launcher
cd launcher && npm run tauri build -- --bundles app

# MURig
cd MURig && npm run tauri build -- --bundles app
```
*(ไฟล์ `.app` ที่คอมไพล์เสร็จจะอยู่ที่ `src-tauri/target/release/bundle/macos/`)*

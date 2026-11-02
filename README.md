# CROD Work Order

ระบบขอทำงานกับศูนย์นนทบุรี ย้ายหน้าเว็บเดิมมาให้เผยแพร่บน GitHub Pages

## Firebase เดิม

- Project: `build-work-order-crod-radombon`
- Collections: `tickets`, `users`, `logs` (schema เดิม)
- บัญชีเดิมและข้อมูลเดิมอยู่ใน Firebase ไม่ได้สำรองไว้ใน repository
- ไม่สร้างบัญชีเริ่มต้นหรือเปลี่ยน Security Rules โดยอัตโนมัติ

## เผยแพร่

GitHub Settings → Pages → Deploy from a branch → main → / (root).
ทุก commit บน main จะเผยแพร่อัตโนมัติ ใช้ relative asset paths รองรับ URL ใต้ชื่อ repository

ทดสอบในเครื่อง: `python -m http.server 8091` และเปิด http://localhost:8091
ตรวจไวยากรณ์: `node --check app.js` และ `node --check firebase-config.js`

## ข้อจำกัดที่คงมาจากระบบเดิม

ระบบเข้าสู่ระบบเดิมตรวจ username/password จาก Firestore และเก็บ password เป็น Base64 ซึ่งไม่ใช่การเข้ารหัสที่ปลอดภัย ส่วนการตรวจ role ในหน้าเว็บไม่ทดแทน Security Rules ฝั่งเซิร์ฟเวอร์ การย้าย hosting ครั้งนี้ไม่ได้เปลี่ยน Authentication หรือ Rules เพื่อหลีกเลี่ยงการทำให้บัญชีเดิมใช้งานไม่ได้ ควรย้ายไป Firebase Authentication และบังคับสิทธิ์ผ่าน Rules ในงานถัดไป

นำ Telegram Bot Token ออกจากซอร์สและปิดการแจ้งเตือน Telegram ของเว็บใหม่นี้แล้ว ต้องเพิกถอน token ที่เคยเปิดเผยในเว็บเก่าผ่าน BotFather และหากเปิดใช้งานใหม่ให้ส่งผ่าน backend ที่ตรวจ Firebase identity เท่านั้น ห้ามใส่ token ใน JavaScript หน้าเว็บ

ไม่นำทะเบียนพนักงานที่เคยฝังในซอร์สมาลง GitHub: กรอกรหัสและข้อมูลผู้ขอทำงานด้วยตนเองได้ตามเดิม รูปภาพหน้าเข้าสู่ระบบเก็บใน assets

## ตรวจรับ

หน้าเข้าสู่ระบบ/asset paths/การอ่าน Firebase ตรวจได้โดยไม่แก้ข้อมูลจริง การสร้าง แก้ไข อนุมัติ ปิดงาน และจัดการสมาชิกต้องทดสอบด้วยบัญชีที่ได้รับสิทธิ์ในสภาพแวดล้อมทดสอบก่อนรับรองการใช้งานครบวงจร

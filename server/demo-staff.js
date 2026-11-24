import bcrypt from "bcryptjs";
import { User } from "./db.js";
// Ders demosu için e-posta yerine kullanıcı adıyla girilen personel hesapları.
// UYARI: Şifre "0" tahmin edilebilir; site internette açıksa DEMO_STAFF=off
// ortam değişkeniyle kapatın veya şifreyi panelden/DB'den değiştirin.
export const DEMO_STAFF = [
  { username: "admin", name: "Admin", role: "admin" },
  { username: "woodybambu", name: "Woody Bambu Yöneticisi", role: "manager" },
];
export const DEMO_PASSWORD = "0";
export const isStaffAlias = (v) =>
  typeof v === "string" &&
  DEMO_STAFF.some((s) => s.username === v.trim().toLowerCase());
export async function seedDemoStaff(env = process.env) {
  if (String(env.DEMO_STAFF || "").toLowerCase() === "off") return;
  for (const s of DEMO_STAFF) {
    // Mevcut hesabın şifresini/rolünü asla ezme.
    if (await User.exists({ email: s.username })) continue;
    await User.create({
      name: s.name,
      email: s.username,
      password: await bcrypt.hash(DEMO_PASSWORD, 12),
      role: s.role,
    });
  }
}

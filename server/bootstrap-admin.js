import bcrypt from "bcryptjs";
import { User } from "./db.js";
// Optional first-account setup for hosts without an interactive shell.
// Never overwrite a user's password or elevate an existing customer account.
export async function bootstrapAdmin({ email, password } = {}) {
  if (!email && !password) return;
  if (
    typeof email !== "string" ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128
  )
    throw Error(
      "Admin kurulumu için geçerli ADMIN_EMAIL ve 12–128 karakterli ADMIN_PASSWORD gerekli",
    );
  const normalized = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalized });
  if (existing) {
    if (existing.role === "admin") return;
    throw Error(
      "Admin kurulumu mevcut kullanıcı hesabını değiştirmez; farklı e-posta kullanın",
    );
  }
  if (await User.exists({ role: "admin" }))
    throw Error(
      "İlk admin zaten var. Yeni roller yönetim panelinden atanmalı",
    );
  await User.create({
    name: "Proje Yöneticisi",
    email: normalized,
    password: await bcrypt.hash(password, 12),
    role: "admin",
  });
  console.log(
    "İlk admin hesabı oluşturuldu. Bootstrap değişkenlerini ortam ayarlarından kaldırabilirsiniz.",
  );
}

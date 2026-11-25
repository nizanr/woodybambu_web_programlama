import bcrypt from "bcryptjs";
import { User } from "./db.js";
// Optional first-account setup for hosts without an interactive shell.
// Never overwrite a user's password or elevate an existing customer account.
export async function bootstrapAdmin({ email, password } = {}) {
  if (!email && !password) return;
  // "admin" kullanıcı adı ders demosu için e-posta biçimi istisnasıdır.
  // Site internette açık olduğundan şifre kuralı (12–128 karakter) bu
  // hesap için de aynen geçerlidir (NFR-01).
  const isAdminAlias =
    typeof email === "string" && email.trim().toLowerCase() === "admin";
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128 ||
    (!isAdminAlias && !/^\S+@\S+\.\S+$/.test(email))
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
    name: "Admin",
    email: normalized,
    password: await bcrypt.hash(password, 12),
    role: "admin",
  });
  console.log(
    "İlk admin hesabı oluşturuldu. Bootstrap değişkenlerini ortam ayarlarından kaldırabilirsiniz.",
  );
}

import { connectDB, User } from "./db.js";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
if (
  !process.env.ADMIN_EMAIL ||
  !process.env.ADMIN_PASSWORD ||
  process.env.ADMIN_PASSWORD.length < 12
)
  throw Error("ADMIN_EMAIL ve en az 12 karakterli ADMIN_PASSWORD gerekli");
await connectDB();
const email = process.env.ADMIN_EMAIL.toLowerCase();
if (await User.exists({ email })) throw Error("Mevcut hesap değiştirilmeyecek");
await User.create({
  name: "Proje Yöneticisi",
  email,
  password: await bcrypt.hash(process.env.ADMIN_PASSWORD, 12),
  role: "admin",
});
console.log("Admin oluşturuldu");
await mongoose.disconnect();
process.exit(0);

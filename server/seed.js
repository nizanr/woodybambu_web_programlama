// İlk açılışta örnek kategoriler/ürünler ve eski verinin yeni yapıya taşınması.
import { User, Product, Category, Setting } from "./db.js";
import { getSettings } from "./helpers.js";

/* ─── Şema geçişleri: eski veriyi SRS modeline taşır (idempotent) ─── */
const CATEGORY_MODELS = {
  "Oturma Grupları": "builtin:sofa",
  Sandalyeler: "builtin:chair",
  Masalar: "builtin:table",
  Şezlonglar: "builtin:lounger",
};
export async function migrate() {
  await getSettings();
  const s = await Setting.findOne({ key: "global" });
  if (!s.schemaVersion) {
    // Rol adları SRS 2.1'e göre: user→customer, admin→manager, superadmin→admin
    const users = User.collection;
    await users.updateMany({ role: "admin" }, { $set: { role: "manager" } });
    await users.updateMany({ role: "superadmin" }, { $set: { role: "admin" } });
    await users.updateMany({ role: "user" }, { $set: { role: "customer" } });
    await Setting.updateOne({ key: "global" }, { $set: { schemaVersion: 2 } });
  }
  const products = Product.collection;
  for (const name of await products.distinct("category"))
    if (name && !(await Category.exists({ name })))
      await Category.create({ name }).catch(() => {});
  for (const c of await Category.find())
    await products.updateMany(
      { category: c.name, categoryId: { $exists: false } },
      { $set: { categoryId: c._id } },
    );
  await products.updateMany(
    { status: { $exists: false } },
    { $set: { status: "published" } },
  );
  for (const [name, model] of Object.entries(CATEGORY_MODELS))
    await products.updateMany(
      { category: name, model3dUrl: { $exists: false } },
      { $set: { model3dUrl: model } },
    );
  await products.updateMany(
    { model3dUrl: { $exists: false } },
    { $set: { model3dUrl: "builtin:chair" } },
  );
}
export async function seed() {
  for (const name of Object.keys(CATEGORY_MODELS))
    if (!(await Category.exists({ name })))
      await Category.create({ name }).catch(() => {});
  if (await Product.countDocuments()) return;
  const cat = async (name) => (await Category.findOne({ name }))._id;
  await Product.insertMany([
    {
      name: "Luna Bahçe Oturma Grubu",
      category: "Oturma Grupları",
      categoryId: await cat("Oturma Grupları"),
      price: 24990,
      stock: 12,
      image: "/images/product-sofa.png",
      description:
        "Doğal ahşabın sıcaklığı, yumuşak minderlerin konforuyla buluşuyor. 4 kişilik takım, açık havada uzun sohbetler için.",
      color: "#b79b77",
      model3dUrl: "builtin:sofa",
    },
    {
      name: "Terra Örgü Sandalye",
      category: "Sandalyeler",
      categoryId: await cat("Sandalyeler"),
      price: 3490,
      stock: 28,
      image: "/images/product-chair.png",
      description:
        "Hafif, dayanıklı ve zamansız. El örgüsü dokusuyla bahçenizin yeni favorisi.",
      color: "#ae8358",
      model3dUrl: "builtin:chair",
    },
    {
      name: "Olive Ahşap Bahçe Masası",
      category: "Masalar",
      categoryId: await cat("Masalar"),
      price: 8990,
      stock: 8,
      image: "/images/product-table.png",
      description:
        "Altı kişilik geniş yüzey ve masif ahşap tasarım. Güneşli kahvaltılara davet.",
      color: "#98734e",
      model3dUrl: "builtin:table",
    },
    {
      name: "Soleil Şezlong",
      category: "Şezlonglar",
      categoryId: await cat("Şezlonglar"),
      price: 6490,
      stock: 16,
      image: "/images/product-lounger.png",
      description:
        "Ayarlanabilir sırt desteği ve rahat minder. Kendinize ayırdığınız anlar için.",
      color: "#d0bc95",
      model3dUrl: "builtin:lounger",
    },
  ]);
}

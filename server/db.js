import mongoose from "mongoose";
export async function connectDB() {
  if (process.env.NODE_ENV === "production" && !process.env.MONGODB_URI)
    throw Error("MONGODB_URI is required in production");
  let uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/bahceni";
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 1500 });
    return uri;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        "Yerel MongoDB bulunamadı, bellek içi (in-memory) MongoDB başlatılıyor...",
      );
      const { MongoMemoryServer } = await import("mongodb-memory-server");
      const mongod = await MongoMemoryServer.create();
      uri = mongod.getUri();
      await mongoose.connect(uri);
      console.log("Bellek içi MongoDB hazır!");
      return uri;
    }
    throw err;
  }
}
const { ObjectId, Mixed } = mongoose.Schema.Types;

/* SRS 2.1 — users. Roller: customer (Üye) / manager (Yönetici) / admin (Admin). */
export const ROLES = ["customer", "manager", "admin"];
const addressSchema = new mongoose.Schema({
  title: { type: String, maxlength: 40 },
  fullName: { type: String, maxlength: 80 },
  city: { type: String, maxlength: 40 },
  district: { type: String, maxlength: 40 },
  line: { type: String, maxlength: 300 },
});
const userSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, unique: true },
    password: String,
    role: { type: String, enum: ROLES, default: "customer" },
    addresses: [addressSchema],
  },
  { timestamps: true },
);
export const User = mongoose.model("User", userSchema);

/* SRS 2.2 — categories */
export const Category = mongoose.model(
  "Category",
  new mongoose.Schema(
    {
      name: { type: String, unique: true },
      isActive: { type: Boolean, default: true },
    },
    { timestamps: true },
  ),
);

/* SRS 2.2 — products. status: published (Yayında) / draft (Taslak) / inactive (Pasif). */
export const PRODUCT_STATUSES = ["published", "draft", "inactive"];
const productSchema = new mongoose.Schema(
  {
    name: String,
    categoryId: ObjectId,
    category: String,
    price: Number,
    stock: Number,
    status: { type: String, enum: PRODUCT_STATUSES, default: "published" },
    image: String,
    images: [String],
    description: String,
    color: String,
    // "" → 3D model yok; "builtin:<chair|sofa|table|lounger>" → temsili
    // Three.js modeli; https://…/*.glb|gltf → harici model dosyası.
    model3dUrl: { type: String, default: "" },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret.id;
        return ret;
      },
    },
  },
);
productSchema.virtual("isActive").get(function () {
  return this.status === "published";
});
export const Product = mongoose.model("Product", productSchema);

/* SRS 2.3 — carts */
export const Cart = mongoose.model(
  "Cart",
  new mongoose.Schema(
    {
      userId: { type: ObjectId, unique: true },
      items: [
        new mongoose.Schema(
          { productId: ObjectId, quantity: Number },
          { _id: false },
        ),
      ],
    },
    { timestamps: true },
  ),
);

/* SRS 2.3 — orders */
export const ORDER_STATUSES = [
  "pending",
  "paid",
  "demo_paid",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
  "stock_conflict",
];
export const Order = mongoose.model(
  "Order",
  new mongoose.Schema(
    {
      user: ObjectId,
      items: Array,
      subtotal: Number,
      discount: { type: Number, default: 0 },
      shipping: { type: Number, default: 0 },
      couponCode: String,
      total: Number,
      address: String,
      status: { type: String, default: "pending" },
      paymentMode: String,
      paymentToken: String,
      settingsVersion: Number,
      stockApplied: { type: Boolean, default: false },
      analyticsSid: String,
    },
    { timestamps: true },
  ),
);

/* SRS 2.4 — payments (iyzico / demo). providerRef benzersizdir: aynı
   sağlayıcı referansıyla ikinci kayıt oluşmaz (BR-007). */
export const Payment = mongoose.model(
  "Payment",
  new mongoose.Schema(
    {
      orderId: { type: ObjectId, index: true },
      provider: { type: String, enum: ["iyzico", "demo"] },
      providerRef: { type: String, unique: true, sparse: true },
      amount: Number,
      status: {
        type: String,
        enum: ["pending", "success", "failed"],
        default: "pending",
      },
    },
    { timestamps: true },
  ),
);

/* SRS 2.5 / 8.2 — events (davranış analizi) */
export const EVENT_TYPES = [
  "product_view",
  "add_to_cart",
  "remove_from_cart",
  "checkout_start",
  "purchase",
];
export const Event = mongoose.model(
  "Event",
  new mongoose.Schema({
    eventId: { type: String, unique: true },
    eventType: { type: String, enum: EVENT_TYPES },
    sessionId: String,
    productId: { type: ObjectId, default: null },
    userId: { type: ObjectId, default: null },
    orderId: { type: ObjectId, default: null },
    consentState: { type: String, enum: ["granted", "anonymous"] },
    occurredAt: { type: Date, index: true },
  }),
);

/* SRS 2.6 — designs (kayıtlı 3D yerleşim) */
export const Design = mongoose.model(
  "Design",
  new mongoose.Schema(
    {
      user: ObjectId,
      name: String,
      productId: String,
      x: Number,
      y: Number,
      scale: Number,
      rotation: Number,
      photoRef: { type: String, default: null },
    },
    { timestamps: true },
  ),
);
/* Bahçe fotoğrafı yalnızca üye yerleşimi kaydedip fotoğrafı eklemeyi
   seçerse saklanır (DEC-07 varsayımı); olaylara/loglara yazılmaz. */
export const DesignPhoto = mongoose.model(
  "DesignPhoto",
  new mongoose.Schema(
    {
      user: ObjectId,
      designId: ObjectId,
      contentType: { type: String, enum: ["image/jpeg", "image/png"] },
      data: Buffer,
      size: Number,
    },
    { timestamps: true },
  ),
);

/* SRS 5 — parametrik ayarlar (tek belge) */
export const Setting = mongoose.model(
  "Setting",
  new mongoose.Schema(
    {
      key: { type: String, unique: true, default: "global" },
      version: { type: Number, default: 1 },
      schemaVersion: Number,
      commerce: Mixed,
      analytics: Mixed,
      preview: Mixed,
      updatedBy: ObjectId,
    },
    { timestamps: true, minimize: false },
  ),
);

/* İndirim kodları (DEC-02 onaylanana kadar sabit tutarlı / yüzdeli basit kupon) */
export const Coupon = mongoose.model(
  "Coupon",
  new mongoose.Schema(
    {
      code: { type: String, unique: true },
      type: { type: String, enum: ["fixed", "percent"] },
      value: Number,
      isActive: { type: Boolean, default: true },
    },
    { timestamps: true },
  ),
);

/* SRS 8.1 — operasyonel denetim kayıtları */
export const AuditLog = mongoose.model(
  "AuditLog",
  new mongoose.Schema({
    actorId: { type: ObjectId, default: null },
    role: String,
    eventType: String,
    targetId: String,
    occurredAt: { type: Date, default: Date.now, index: true },
    before: Mixed,
    after: Mixed,
    result: String,
    correlationId: String,
  }),
);

/* SRS 7 — sistem içi bildirimler */
export const Notification = mongoose.model(
  "Notification",
  new mongoose.Schema(
    {
      recipientId: { type: ObjectId, default: null },
      audience: { type: String, enum: ["user", "staff", "admin"] },
      type: String,
      message: String,
      read: { type: Boolean, default: false },
    },
    { timestamps: true },
  ),
);

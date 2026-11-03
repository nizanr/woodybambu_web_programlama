// Test veritabanı: MONGODB_TEST_URI tanımlıysa onu (ör. mongodb://127.0.0.1:27017),
// değilse geçici bir bellek içi MongoDB kullanır. Her dosya kendi veritabanını açar.
let memory;
export async function testUri(name) {
  const base = process.env.MONGODB_TEST_URI;
  if (base) return base.replace(/\/$/, "") + "/" + name + "_" + Date.now();
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  memory ??= await MongoMemoryServer.create();
  return memory.getUri() + name;
}
export async function stopMemory() {
  await memory?.stop();
  memory = undefined;
}

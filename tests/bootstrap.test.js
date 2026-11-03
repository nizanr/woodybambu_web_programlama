import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "../server/db.js";
import { bootstrapAdmin } from "../server/bootstrap-admin.js";
import { testUri, stopMemory } from "./helpers/mongo.js";
before(async () => {
  await mongoose.connect(await testUri("bahceni_bootstrap_test"));
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await stopMemory();
});
test("missing optional bootstrap does not create an account", async () => {
  await bootstrapAdmin();
  assert.equal(await User.countDocuments(), 0);
});
test("invalid bootstrap password is rejected", async () => {
  await assert.rejects(
    bootstrapAdmin({ email: "owner@test.example", password: "short" }),
  );
  assert.equal(await User.countDocuments(), 0);
});
test("existing customer cannot be promoted by bootstrap", async () => {
  await User.create({
    name: "Customer",
    email: "customer@test.example",
    password: "existing-hash",
    role: "customer",
  });
  await assert.rejects(
    bootstrapAdmin({
      email: "customer@test.example",
      password: "ExamplePass123!",
    }),
  );
  assert.equal(
    (await User.findOne({ email: "customer@test.example" })).role,
    "customer",
  );
});
test("first admin gets hashed password and admin role", async () => {
  await bootstrapAdmin({
    email: "OWNER@test.example",
    password: "ExamplePass123!",
  });
  const u = await User.findOne({ email: "owner@test.example" });
  assert.equal(u.role, "admin");
  assert.notEqual(u.password, "ExamplePass123!");
  assert.ok(await bcrypt.compare("ExamplePass123!", u.password));
});
test("restart never resets existing admin password", async () => {
  const before = await User.findOne({ email: "owner@test.example" });
  await bootstrapAdmin({
    email: "owner@test.example",
    password: "DifferentPass123!",
  });
  assert.equal((await User.findById(before.id)).password, before.password);
});
test("bootstrap cannot create a second admin", async () => {
  await assert.rejects(
    bootstrapAdmin({
      email: "other@test.example",
      password: "ExamplePass123!",
    }),
  );
  assert.equal(await User.countDocuments({ role: "admin" }), 1);
});

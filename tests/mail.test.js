// FR-023 / DEC-06 — SMTP istemcisi, sahte yerel sunucuyla (ağ gerekmez).
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { sendMail, mailConfigFromEnv } from "../server/mail.js";

function fakeSmtp() {
  const got = { commands: [], data: "" };
  const server = net.createServer((s) => {
    let inData = false,
      buf = "";
    s.write("220 fake ready\r\n");
    s.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            s.write("250 queued\r\n");
          } else got.data += line + "\n";
          continue;
        }
        got.commands.push(line);
        if (line.startsWith("EHLO")) s.write("250-fake\r\n250 AUTH PLAIN\r\n");
        else if (line.startsWith("AUTH")) s.write("235 ok\r\n");
        else if (line.startsWith("MAIL") || line.startsWith("RCPT")) s.write("250 ok\r\n");
        else if (line === "DATA") {
          inData = true;
          s.write("354 go\r\n");
        } else if (line === "QUIT") s.end("221 bye\r\n");
      }
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, got, port: server.address().port })));
}

test("mail is skipped when SMTP is not configured", async () => {
  assert.equal(mailConfigFromEnv({}), null);
  assert.deepEqual(await sendMail({ to: "a@b.co", subject: "x", text: "y" }, null), { skipped: true });
});

test("SMTP conversation sends a UTF-8 message", async () => {
  const { server, got, port } = await fakeSmtp();
  const cfg = { host: "127.0.0.1", port, user: "u@test.dev", pass: "secret", from: "shop@test.dev" };
  const r = await sendMail(
    { to: "musteri@test.dev", subject: "Siparişiniz kargolandı", text: "Merhaba, siparişiniz yolda." },
    cfg,
    { allowPlain: true },
  );
  assert.equal(r.sent, true);
  assert.ok(got.commands.includes("MAIL FROM:<shop@test.dev>"));
  assert.ok(got.commands.includes("RCPT TO:<musteri@test.dev>"));
  assert.match(got.data, /Subject: =\?UTF-8\?B\?/);
  const body = got.data.split("\n\n")[1].replace(/\n/g, "");
  assert.equal(Buffer.from(body, "base64").toString(), "Merhaba, siparişiniz yolda.");
  server.close();
});

test("plain-text SMTP without TLS is refused outside tests; bad recipients rejected", async () => {
  const { server, port } = await fakeSmtp();
  const cfg = { host: "127.0.0.1", port, user: "u", pass: "p", from: "s@test.dev" };
  await assert.rejects(sendMail({ to: "a@test.dev", subject: "x", text: "y" }, cfg), /şifreli/);
  await assert.rejects(sendMail({ to: "a@test.dev\r\nRCPT TO:<x@y.z>", subject: "x", text: "y" }, cfg));
  server.close();
});

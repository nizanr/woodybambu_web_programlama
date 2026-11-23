/* FR-023 / DEC-06 — e-posta bildirimi için bağımlılıksız SMTP istemcisi.
   Ortam değişkenleri: SMTP_HOST, SMTP_PORT (465 → doğrudan TLS, diğerleri
   STARTTLS), SMTP_USER, SMTP_PASS, MAIL_FROM. Tanımlı değilse e-posta
   gönderilmez; site içi bildirimler aynen çalışır. Şifre ve ileti içeriği
   loglara yazılmaz. */
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";

export const mailConfigFromEnv = (env = process.env) =>
  env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS
    ? {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT) || 465,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from: env.MAIL_FROM || env.SMTP_USER,
      }
    : null;

const clean = (v) => String(v).replace(/[\r\n]+/g, " ").trim();
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const emailOk = (v) => typeof v === "string" && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(v);

/* Sunucu yanıtlarını satır satır okur; çok satırlı yanıtları ("250-…") birleştirir. */
function reader(socket) {
  let buf = "";
  const waiting = [];
  const lines = [];
  const flush = () => {
    while (waiting.length) {
      const end = lines.findIndex((l) => /^\d{3} /.test(l));
      if (end < 0) return;
      const block = lines.splice(0, end + 1);
      waiting.shift().resolve({ code: Number(block[end].slice(0, 3)), text: block.join("\n") });
    }
  };
  const onData = (d) => {
    buf += d.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      lines.push(buf.slice(0, i).replace(/\r$/, ""));
      buf = buf.slice(i + 1);
    }
    flush();
  };
  const onError = (e) => {
    while (waiting.length) waiting.shift().reject(e);
  };
  socket.on("data", onData);
  socket.on("error", onError);
  return {
    next: () =>
      new Promise((resolve, reject) => {
        waiting.push({ resolve, reject });
        flush();
      }),
    detach: () => {
      socket.off("data", onData);
      socket.off("error", onError);
    },
  };
}

/* options.allowPlain yalnızca testlerde kullanılır: şifreli bağlantı olmadan
   kimlik bilgisi gönderilmesine izin verir. Ortam değişkenleriyle açılamaz. */
export async function sendMail({ to, subject, text }, config, options = {}) {
  if (!config) return { skipped: true };
  if (!emailOk(to)) throw Error("Geçersiz alıcı");
  const timeout = options.timeoutMs || 15000;
  let socket =
    config.port === 465 && !options.allowPlain
      ? tls.connect({ host: config.host, port: config.port, servername: config.host })
      : net.connect({ host: config.host, port: config.port });
  socket.setTimeout(timeout, () => socket.destroy(Error("SMTP zaman aşımı")));
  let r = reader(socket);
  const write = (line) => socket.write(line + "\r\n");
  const expect = async (codes, line) => {
    if (line !== undefined) write(line);
    const res = await r.next();
    if (!codes.includes(res.code)) throw Error("SMTP yanıtı " + res.code);
    return res;
  };
  try {
    await expect([220]);
    const helo = "EHLO woody-bambu";
    let ehlo = await expect([250], helo);
    const encrypted = socket instanceof tls.TLSSocket;
    if (!encrypted) {
      if (/STARTTLS/i.test(ehlo.text)) {
        await expect([220], "STARTTLS");
        r.detach();
        socket = tls.connect({ socket, servername: config.host });
        socket.setTimeout(timeout, () => socket.destroy(Error("SMTP zaman aşımı")));
        await new Promise((res, rej) => {
          socket.once("secureConnect", res);
          socket.once("error", rej);
        });
        r = reader(socket);
        ehlo = await expect([250], helo);
      } else if (!options.allowPlain) throw Error("SMTP sunucusu şifreli bağlantı sunmuyor");
    }
    await expect([235], "AUTH PLAIN " + b64(`\0${config.user}\0${config.pass}`));
    await expect([250], `MAIL FROM:<${clean(config.from)}>`);
    await expect([250, 251], `RCPT TO:<${clean(to)}>`);
    await expect([354], "DATA");
    const body = b64(text).replace(/.{1,76}/g, "$&\r\n");
    const msg = [
      `From: Woody Bambu <${clean(config.from)}>`,
      `To: <${clean(to)}>`,
      `Subject: ${encodeHeader(clean(subject))}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@woody-bambu>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      body,
    ].join("\r\n");
    socket.write(msg + "\r\n.\r\n");
    await expect([250]);
    write("QUIT");
    return { sent: true };
  } finally {
    socket.end();
    setTimeout(() => socket.destroy(), 1000).unref();
  }
}

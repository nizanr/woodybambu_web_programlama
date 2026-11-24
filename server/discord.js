// Yeni sipariş / durum değişikliği bildirimini Discord kanalına gönderir.
// DISCORD_WEBHOOK_URL yoksa sessizce atlanır. Hata siparişi asla bozmaz.
export async function notifyDiscord(payload, env = process.env) {
  const url = env.DISCORD_WEBHOOK_URL;
  if (!url || !/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(url))
    return false;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch (e) {
    console.error("discord:", e.message);
    return false;
  }
}
export const orderEmbed = (o, no, appUrl, title = "Yeni sipariş") => ({
  embeds: [
    {
      title: `${title} ${no}`,
      url: appUrl || undefined,
      color: 0x455147,
      description: o.items
        .map(
          (i) =>
            `• ${i.name}${i.colorName ? ` (${i.colorName})` : ""} × ${i.quantity}`,
        )
        .join("\n")
        .slice(0, 1500),
      fields: [
        { name: "Tutar", value: `${o.total} TL`, inline: true },
        { name: "Teslimat adresi", value: String(o.address).slice(0, 500) },
        {
          name: "Sonraki adım",
          value: "Yönetim panelinden siparişi “Kargolandı” yapın.",
        },
      ],
      timestamp: new Date().toISOString(),
    },
  ],
});

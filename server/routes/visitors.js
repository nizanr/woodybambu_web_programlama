// Canlı ziyaretçi sayacı (Server-Sent Events)

export default function registerVisitorsRoutes(app) {
  /* ─── Canlı ziyaretçi sayacı (SSE) ─── */
  const visitors = new Set();
  const broadcast = () => {
    const data = `data: ${JSON.stringify({ count: visitors.size })}\n\n`;
    for (const res of visitors) res.write(data);
  };
  app.get("/api/visitors/stream", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ count: visitors.size + 1 })}\n\n`);
    visitors.add(res);
    broadcast();
    req.on("close", () => {
      visitors.delete(res);
      broadcast();
    });
  });
  app.get("/api/visitors/count", (req, res) =>
    res.json({ count: visitors.size }),
  );
}

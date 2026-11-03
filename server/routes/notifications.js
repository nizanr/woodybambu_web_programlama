// Sistem içi bildirimler
import { Notification } from "../db.js";
import { isId, STAFF, auth } from "../helpers.js";

export default function registerNotificationsRoutes(app) {
  /* ─── Bildirimler ─── */
  const notificationQuery = (u) => ({
    $or: [
      { recipientId: u._id },
      ...(STAFF.includes(u.role) ? [{ audience: "staff" }] : []),
      ...(u.role === "admin" ? [{ audience: "admin" }] : []),
    ],
  });
  app.get("/api/notifications", auth, async (req, res) =>
    res.json(
      await Notification.find(notificationQuery(req.currentUser))
        .sort({ createdAt: -1 })
        .limit(50),
    ),
  );
  app.post("/api/notifications/:id/read", auth, async (req, res) => {
    if (!isId(req.params.id)) return res.sendStatus(404);
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, ...notificationQuery(req.currentUser) },
      { $set: { read: true } },
      { new: true },
    );
    if (!n) return res.sendStatus(404);
    res.json(n);
  });
}

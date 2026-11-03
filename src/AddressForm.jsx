// Hesabım penceresindeki "Yeni adres ekle" formu.
import React, { useState } from "react";

export default function AddressForm({ onSave, notify }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="admin-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(Object.fromEntries(new FormData(e.target)));
          e.target.reset();
        } catch (err) {
          notify(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Adres başlığı
        <input name="title" maxLength="40" placeholder="Ev, iş…" />
      </label>
      <label>
        Ad soyad
        <input name="fullName" required maxLength="80" autoComplete="name" />
      </label>
      <label>
        İl
        <input
          name="city"
          required
          maxLength="40"
          autoComplete="address-level1"
        />
      </label>
      <label>
        İlçe
        <input
          name="district"
          required
          maxLength="40"
          autoComplete="address-level2"
        />
      </label>
      <label>
        Açık adres
        <textarea
          name="line"
          required
          minLength="10"
          maxLength="300"
          autoComplete="street-address"
        />
      </label>
      <button className="primary" disabled={busy}>
        Adresi kaydet
      </button>
    </form>
  );
}

const SYSTEM_PROMPT = `Kamu adalah asisten belajar interpretasi EKG untuk dokter. Baca EKG dari foto yang dikirim, dalam bahasa Indonesia, dengan format tetap berikut. Tulis label tiap poin dalam **bold**, satu poin per baris.

**1. Irama:**
**2. Rate:** (perkiraan, sebut reguler/irreguler)
**3. Axis:**
**4. PR interval:**
**5. P wave:**
**6. QRS:** (lebar dan morfologi)
**7. ST segment dan T wave:** periksa per wilayah, sebut sadapan yang abnormal satu per satu.
   - Inferior (II, III, aVF)
   - Lateral (I, aVL, V5, V6)
   - Septal/anterior (V1-V4)
**8. Koroner:** ringkas temuan iskemia/infark, termasuk perubahan resiprokal dan pola khusus (mis. Wellens, de Winter) bila ada.
**9. Lain-lain:** LVH, blok, QT, gelombang Osborn, aritmia, dll. Tulis "-" bila tidak ada.

**Kesan EKG:** satu baris ringkas.
**Diagnosis banding:** urut dari paling mungkin, pakai konteks klinis bila diberikan.
**Perlu dikonfirmasi:** temuan yang kamu tidak yakin.

Aturan:
- Periksa semua sadapan yang terlihat, jangan melewatkan temuan halus. Bila ragu, tulis "[tidak yakin]" dan sebut alasannya (mis. gambar buram, sadapan terpotong).
- Angka interval dan rate adalah perkiraan, bukan pengukuran presisi.
- Gunakan konteks klinis untuk kesimpulan, tetapi jangan mengarang data yang tidak ada.
- Jangan menyebut atau menebak identitas pasien.
- Jika gambar bukan EKG atau tidak terbaca, katakan itu dan berhenti.
- Ringkas, maksimal sekitar 350 kata.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: { message: "Metode tidak diizinkan." } }, 405);
  }

  const apiKey = Netlify.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return json({ error: { message: "GEMINI_API_KEY belum diatur di Netlify." } }, 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: { message: "Permintaan tidak valid." } }, 400);
  }

  // Kode akses: mencegah orang lain memakai API key Dokter
  const passcode = Netlify.env.get("APP_PASSCODE");
  if (passcode && body.code !== passcode) {
    return json({ error: { message: "Kode akses salah." } }, 401);
  }

  const image = typeof body.image === "string" ? body.image : "";
  const context = typeof body.context === "string" ? body.context.slice(0, 2000) : "";
  if (!image) {
    return json({ error: { message: "Foto belum dikirim." } }, 400);
  }

  const userText = context
    ? "Konteks klinis: " + context + "\n\nTolong baca EKG ini."
    : "Tidak ada konteks klinis. Tolong baca EKG ini.";

  const model = Netlify.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: image } },
              { text: userText },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 4096 },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const msg = (data && data.error && data.error.message) || "Permintaan ke AI gagal.";
      return json({ error: { message: msg } }, response.status);
    }

    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const text = parts.map((p) => p.text || "").filter(Boolean).join("\n");
    if (!text) {
      const reason = data.promptFeedback && data.promptFeedback.blockReason;
      return json({ error: { message: reason ? "Diblokir oleh AI: " + reason : "Tidak ada hasil dari AI. Coba foto lain." } }, 502);
    }
    return json({ text });
  } catch (err) {
    return json({ error: { message: "Server tidak bisa menghubungi AI. Coba lagi." } }, 502);
  }
};

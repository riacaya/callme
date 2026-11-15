(function () {
  const MAX_EDGE = 384;

  function asDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () =>
        reject(reader.error || new Error("Gagal membaca foto"));
      reader.readAsDataURL(blob);
    });
  }

  function decodeImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      const release = () => URL.revokeObjectURL(url);
      image.onload = () => {
        release();
        resolve(image);
      };
      image.onerror = () => {
        release();
        reject(new Error("Foto profil tidak dapat dibuka"));
      };
      image.src = url;
    });
  }

  async function optimize(source) {
    if (!source) return { dataUrl: "", filename: "profil.png", size: 0 };
    const input =
      source instanceof Blob
        ? source
        : await fetch(source).then((response) => {
            if (!response.ok) throw new Error("Foto profil tidak dapat dibaca");
            return response.blob();
          });
    if (!input.type.startsWith("image/"))
      throw new Error("File profil bukan gambar");

    let bitmap;
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(input);
      } catch {
        bitmap = await decodeImage(input);
      }
    } else {
      bitmap = await decodeImage(input);
    }
    const width = bitmap.width || bitmap.naturalWidth;
    const height = bitmap.height || bitmap.naturalHeight;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas gambar tidak tersedia");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const jpeg = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Foto JPEG gagal dibuat")),
        "image/jpeg",
        0.78,
      );
    });
    return {
      dataUrl: await asDataUrl(jpeg),
      filename: "profil.jpg",
      mime: "image/jpeg",
      size: jpeg.size,
      width: canvas.width,
      height: canvas.height,
    };
  }

  window.CallMeProfileImage = Object.freeze({ optimize });
})();

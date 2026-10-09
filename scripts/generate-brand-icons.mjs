import sharp from "sharp";

const mark = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="512"
  height="512"
  viewBox="0 0 64 64"
>
  <circle
    cx="32"
    cy="12"
    r="5.5"
    fill="#4B394F"
  />

  <path
    d="M28.5 23C23.2 24.2 17.8 29.4 13.8 36.3C10.2 42.6 12.3 48.3 17.9 49.6C23 50.8 26.2 46.6 28.4 40.5C30.5 34.5 31.6 27.2 28.5 23Z"
    fill="#E7D6C4"
  />

  <path
    d="M35.5 23C40.8 24.2 46.2 29.4 50.2 36.3C53.8 42.6 51.7 48.3 46.1 49.6C41 50.8 37.8 46.6 35.6 40.5C33.5 34.5 32.4 27.2 35.5 23Z"
    fill="#4B394F"
  />
</svg>
`;

async function createIcon(size, file, padding = 0.18) {
  const innerSize = Math.round(size * (1 - padding * 2));

  const renderedMark = await sharp(Buffer.from(mark))
    .resize(innerSize, innerSize)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: "#F6F0E8",
    },
  })
    .composite([
      {
        input: renderedMark,
        gravity: "center",
      },
    ])
    .png()
    .toFile(file);
}

await createIcon(192, "public/pwa-192x192.png", 0.14);

await createIcon(512, "public/pwa-512x512.png", 0.14);

/* Больше safe-area для Android maskable */
await createIcon(512, "public/pwa-maskable-512x512.png", 0.23);

/* Apple touch icon */
await createIcon(180, "public/apple-touch-icon.png", 0.16);

const notificationMark = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="96"
  height="96"
  viewBox="0 0 64 64"
>
  <circle
    cx="32"
    cy="12"
    r="5.5"
    fill="#FFFFFF"
  />

  <path
    d="M28.5 23C23.2 24.2 17.8 29.4 13.8 36.3C10.2 42.6 12.3 48.3 17.9 49.6C23 50.8 26.2 46.6 28.4 40.5C30.5 34.5 31.6 27.2 28.5 23Z"
    fill="#FFFFFF"
  />

  <path
    d="M35.5 23C40.8 24.2 46.2 29.4 50.2 36.3C53.8 42.6 51.7 48.3 46.1 49.6C41 50.8 37.8 46.6 35.6 40.5C33.5 34.5 32.4 27.2 35.5 23Z"
    fill="#FFFFFF"
  />
</svg>
`;

await sharp(Buffer.from(notificationMark))
  .resize(72, 72)
  .extend({
    top: 12,
    bottom: 12,
    left: 12,
    right: 12,
    background: {
      r: 0,
      g: 0,
      b: 0,
      alpha: 0,
    },
  })
  .png()
  .toFile("public/notification-badge.png");

console.log("Apchi brand icons generated.");

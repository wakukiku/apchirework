import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});

const publicJwk = publicKey.export({ format: "jwk" });
const privateJwk = privateKey.export({ format: "jwk" });

if (!publicJwk.x || !publicJwk.y || !privateJwk.d) {
  throw new Error("Не удалось сгенерировать VAPID key pair.");
}

const x = Buffer.from(publicJwk.x, "base64url");
const y = Buffer.from(publicJwk.y, "base64url");
const publicVapid = Buffer.concat([Buffer.from([0x04]), x, y]).toString(
  "base64url",
);
const privateVapid = Buffer.from(privateJwk.d, "base64url").toString(
  "base64url",
);

console.log("VAPID_PUBLIC_KEY=" + publicVapid);
console.log("VAPID_PRIVATE_KEY=" + privateVapid);
console.log("VAPID_SUBJECT=https://apchi.fun");

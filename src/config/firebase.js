const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const getFirebaseAdmin = () => {
  if (admin.apps.length) {
    return admin;
  }

  const serviceAccountPath =
    path.join(process.cwd(), "serviceAccountKey.json");

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Firebase service account file not found: ${serviceAccountPath}`);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  return admin;
};

module.exports = getFirebaseAdmin;
